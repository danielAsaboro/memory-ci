import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { ApiServices } from "../api/router";
import { AuditRepository } from "../db/audit";
import { CandidateRepository } from "../db/candidates";
import { withTenantTransaction, type TenantTransaction } from "../db/client";
import { OutboxRepository } from "../db/outbox";
import { DomainError } from "../domain/errors";
import { screenCandidate as screen } from "../domain/screening";
import { explainMemory } from "../services/explain-memory";
import { ingestCandidate } from "../services/ingest-candidate";
import { promoteCandidate } from "../services/promote-candidate";
import { retrieveActiveMemory } from "../services/retrieve-memory";
import { createReadWorkspaceServices } from "../services/read-workspace";
import { decideReview } from "../services/review-candidate";
import { rollbackMemory } from "../services/rollback-memory";

export { bootstrapWorkspace } from "../services/bootstrap-workspace";

const asString = (input: Record<string, unknown>, key: string) => {
  const value = input[key];
  if (typeof value !== "string") throw new DomainError("invalid_input", `${key} is required.`);
  return value;
};

export function createApiServices(pool: Pool): ApiServices {
  const run = <T>(context: Parameters<ApiServices["getCandidate"]>[0], operation: (transaction: TenantTransaction) => Promise<T>) =>
    withTenantTransaction(pool, context.tenantId, operation);
  const readWorkspace = createReadWorkspaceServices(pool);

  return {
    ...readWorkspace,
    createCandidate: (context, input) => run(context, async (transaction) => ingestCandidate(context, input as never, {
      namespaces: { get: async (id) => {
        const result = await transaction.client.query<{ protected: boolean }>("SELECT protected FROM agent_namespaces WHERE tenant_id=$1 AND id=$2", [context.tenantId, id]);
        return result.rows[0] ?? null;
      } },
      sources: { upsert: async (source) => {
        await transaction.client.query(
          `UPSERT INTO sources (tenant_id,id,source_type,source_uri,trust_class,content_digest,signature_identity,signature_verified,valid_until,submitted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [context.tenantId, source.id, source.sourceType, source.sourceUri, source.trustClass, source.contentDigest,
            source.signatureIdentity, source.signatureVerified, source.validUntil, source.submittedBy],
        );
        return { id: source.id };
      } },
      candidates: new CandidateRepository(transaction), audit: new AuditRepository(transaction),
      outbox: new OutboxRepository(transaction),
      authorizeProtectedNamespace: async () => context.roles.some((role) => role === "admin" || role === "reviewer"),
      id: randomUUID,
    })),
    screenCandidate: (context, input) => run(context, async (transaction) => {
      const candidateId = asString(input, "candidateId");
      const candidates = new CandidateRepository(transaction);
      const candidate = await candidates.get(candidateId);
      if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
      if (candidate.state === "proposed") await candidates.transition(candidateId, "screening");
      const detail = await transaction.client.query<{
        canonical_text: string; protected: boolean; signature_verified: boolean; valid_until: Date | null;
      }>(`SELECT c.canonical_text,n.protected,s.signature_verified,s.valid_until FROM memory_candidates c
          JOIN agent_namespaces n ON n.tenant_id=c.tenant_id AND n.id=c.namespace_id
          JOIN sources s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
          WHERE c.tenant_id=$1 AND c.id=$2`, [context.tenantId, candidateId]);
      const row = detail.rows[0]!;
      const seen = await transaction.client.query<{ content_digest: string }>(
        "SELECT content_digest FROM memory_candidates WHERE tenant_id=$1 AND content_digest=$2 AND id<>$3", [context.tenantId, candidate.contentDigest, candidateId],
      );
      const findings = screen({ canonicalText: row.canonical_text, memoryClass: candidate.memoryClass,
        trustClass: candidate.trustClass, namespaceProtected: row.protected, sourceSignatureVerified: row.signature_verified,
        sourceExpiresAt: row.valid_until ?? undefined, contentDigest: candidate.contentDigest,
        seenContentDigests: seen.rows.map((item) => item.content_digest), attributionPreserved: true, now: new Date() });
      for (const finding of findings) await transaction.client.query(
        `INSERT INTO screening_findings (tenant_id,id,candidate_id,rule_id,rule_version,severity,message,safe_evidence)
         VALUES ($1,$2,$3,$4,'1',$5,$6,$7)`,
        [context.tenantId, randomUUID(), candidateId, finding.ruleId, finding.severity, finding.message,
          finding.evidence ? { evidence: finding.evidence } : null],
      );
      const blocked = findings.some((finding) => finding.severity === "high" || finding.severity === "critical");
      const updated = await candidates.transition(candidateId, blocked ? "quarantined" : "evaluating");
      await new AuditRepository(transaction).append({ actorId: context.principalId, action: blocked ? "candidate.quarantined" : "candidate.screened",
        resourceType: "memory_candidate", resourceId: candidateId, requestId: context.requestId,
        safeDetails: { findingCount: findings.length, blocked } });
      return { candidate: updated, findings };
    }),
    evaluateCandidate: (context, input) => run(context, async (transaction) => {
      const candidateId = asString(input, "candidateId");
      const candidate = await new CandidateRepository(transaction).get(candidateId);
      if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
      if (candidate.state !== "evaluating") throw new DomainError("conflict", "Candidate is not ready for evaluation.");
      const event = await new OutboxRepository(transaction).enqueue({ eventType: "candidate.evaluation_requested",
        aggregateType: "memory_candidate", aggregateId: candidateId, payload: { tenantId: context.tenantId, candidateId } });
      return { candidateId, status: "queued", eventId: event.id };
    }),
    reviewCandidate: (context, input) => run(context, async (transaction) => {
      const evaluationRunId = asString(input, "evaluationRunId");
      const policy = await transaction.client.query<{ policy_version: string }>(
        "SELECT policy_version FROM evaluation_runs WHERE tenant_id=$1 AND id=$2", [context.tenantId, evaluationRunId],
      );
      if (!policy.rows[0]) throw new DomainError("not_found", "Evaluation was not found.");
      return decideReview(transaction, context, { candidateId: asString(input, "candidateId"), evaluationRunId,
        requestedDecision: asString(input, "decision") as "approved" | "rejected" | "quarantined",
        reason: asString(input, "reason"), policyVersion: policy.rows[0].policy_version });
    }),
    promoteCandidate: (context, input) => run(context, (transaction) => promoteCandidate(transaction, context, {
      candidateId: asString(input, "candidateId"), reviewId: asString(input, "reviewId"), stableKey: asString(input, "stableKey"),
      reason: asString(input, "reason"), idempotencyKey: asString(input, "idempotencyKey"),
    })),
    rollbackLineage: (context, input) => run(context, (transaction) => rollbackMemory(transaction, context, {
      lineageId: asString(input, "lineageId"), targetVersionId: asString(input, "targetVersionId"),
      reason: asString(input, "reason"), idempotencyKey: asString(input, "idempotencyKey"),
    })),
    searchMemory: (context, input) => run(context, (transaction) => retrieveActiveMemory(transaction, context, {
      namespaceId: asString(input, "namespaceId"), query: asString(input, "query"), purpose: asString(input, "purpose"),
      revision: typeof input.revision === "number" ? input.revision : undefined,
    })),
    explainMemory: (context, input) => run(context, (transaction) => explainMemory(transaction, asString(input, "memoryId"))),
    namespaceRevision: (context, input) => run(context, async (transaction) => {
      const namespaceId = asString(input, "namespaceId");
      const result = await transaction.client.query<{ current_revision: string }>(
        "SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2", [context.tenantId, namespaceId],
      );
      if (!result.rows[0]) throw new DomainError("not_found", "Namespace was not found.");
      return { namespaceId, revision: Number(result.rows[0].current_revision) };
    }),
  };
}
