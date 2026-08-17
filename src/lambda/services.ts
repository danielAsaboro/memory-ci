import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { ApiServices } from "../api/router";
import { AuditRepository } from "../db/audit";
import { CandidateRepository } from "../db/candidates";
import { withTenantTransaction, type TenantTransaction } from "../db/client";
import { OutboxRepository } from "../db/outbox";
import { LifecycleReceiptRepository } from "../db/lifecycle-receipts";
import { DomainError } from "../domain/errors";
import { screenCandidate as screen } from "../domain/screening";
import { explainMemory } from "../services/explain-memory";
import { ingestCandidate } from "../services/ingest-candidate";
import { promoteCandidate } from "../services/promote-candidate";
import { retrieveActiveMemory } from "../services/retrieve-memory";
import { createReadWorkspaceServices } from "../services/read-workspace";
import { decideReview } from "../services/review-candidate";
import { rollbackMemory } from "../services/rollback-memory";
import { createEmbeddingProvider } from "../services/embedding-provider";
import { createTrustedSourceKeyRegistry } from "../services/source-signature";
import { canonicalJson } from "../services/provenance";

export { bootstrapWorkspace } from "../services/bootstrap-workspace";

const asString = (input: Record<string, unknown>, key: string) => {
  const value = input[key];
  if (typeof value !== "string") throw new DomainError("invalid_input", `${key} is required.`);
  return value;
};
const requireLifecycleRole = (context: Parameters<ApiServices["getCandidate"]>[0]) => {
  if (!context.roles.some((role) => role === "admin" || role === "reviewer")) throw new DomainError("forbidden", "Reviewer authorization is required for lifecycle mutations.");
};

function immutableSourceEvidence(source: Record<string, unknown>) {
  return canonicalJson({ sourceType: source.sourceType, sourceUri: source.sourceUri, trustClass: source.trustClass,
    contentDigest: source.contentDigest, signatureIdentity: source.signatureIdentity, signatureKeyId: source.signatureKeyId,
    signatureKeyFingerprint: source.signatureKeyFingerprint, signaturePublicKey: source.signaturePublicKey,
    signatureRegistryVersion: source.signatureRegistryVersion, signatureAlgorithm: source.signatureAlgorithm,
    signature: source.signature, canonicalSignedPayload: source.canonicalSignedPayload,
    signaturePayloadVersion: source.signaturePayloadVersion, signatureVerified: source.signatureVerified,
    validUntil: source.validUntil ? new Date(source.validUntil as Date).toISOString() : null });
}

export function createApiServices(pool: Pool): ApiServices {
  const embeddings = createEmbeddingProvider();
  const trustedSourceKeys = createTrustedSourceKeyRegistry();
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
        const inserted = await transaction.client.query<{ id: string }>(
          `INSERT INTO sources (tenant_id,id,source_type,source_uri,trust_class,content_digest,signature_identity,signature_key_id,signature_key_fingerprint,signature_public_key,signature_registry_version,signature_algorithm,signature,canonical_signed_payload,signature_payload_version,signature_verified,valid_until,submitted_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (tenant_id,id) DO NOTHING RETURNING id`,
          [context.tenantId, source.id, source.sourceType, source.sourceUri, source.trustClass, source.contentDigest,
            source.signatureIdentity, source.signatureKeyId, source.signatureKeyFingerprint, source.signaturePublicKey, source.signatureRegistryVersion, source.signatureAlgorithm, source.signature,
            source.canonicalSignedPayload, source.signaturePayloadVersion, source.signatureVerified, source.validUntil, source.submittedBy],
        );
        if (!inserted.rowCount) {
          const existing = await transaction.client.query<Record<string, unknown>>(
            `SELECT source_type AS "sourceType",source_uri AS "sourceUri",trust_class AS "trustClass",content_digest AS "contentDigest",
                    signature_identity AS "signatureIdentity",signature_key_id AS "signatureKeyId",signature_key_fingerprint AS "signatureKeyFingerprint",
                    signature_public_key AS "signaturePublicKey",signature_registry_version AS "signatureRegistryVersion",signature_algorithm AS "signatureAlgorithm",
                    signature,canonical_signed_payload AS "canonicalSignedPayload",signature_payload_version AS "signaturePayloadVersion",
                    signature_verified AS "signatureVerified",valid_until AS "validUntil"
             FROM sources WHERE tenant_id=$1 AND id=$2`, [context.tenantId, source.id]);
          if (!existing.rows[0] || immutableSourceEvidence(existing.rows[0]) !== immutableSourceEvidence(source)) {
            throw new DomainError("conflict", "Source evidence is immutable once recorded.");
          }
        }
        return { id: source.id };
      } },
      candidates: new CandidateRepository(transaction), audit: new AuditRepository(transaction),
      outbox: new OutboxRepository(transaction),
      embeddings,
      trustedSourceKeys,
      authorizeProtectedNamespace: async () => context.roles.some((role) => role === "admin" || role === "reviewer"),
      id: randomUUID,
    })),
    screenCandidate: (context, input) => run(context, async (transaction) => {
      requireLifecycleRole(context);
      const candidateId = asString(input, "candidateId");
      return new LifecycleReceiptRepository(transaction).replay({ operation: "candidate.screen", resourceId: candidateId, idempotencyKey: asString(input, "idempotencyKey"), request: input, execute: async () => {
      const candidates = new CandidateRepository(transaction);
      const candidate = await candidates.get(candidateId);
      if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
      if (candidate.state === "proposed") await candidates.transition(candidateId, "screening");
      const detail = await transaction.client.query<{
        canonical_text: string; protected: boolean; signature_verified: boolean; signature: string | null; valid_until: Date | null;
      }>(`SELECT c.canonical_text,n.protected,s.signature_verified,s.signature,s.valid_until FROM memory_candidates c
          JOIN agent_namespaces n ON n.tenant_id=c.tenant_id AND n.id=c.namespace_id
          JOIN sources s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
          WHERE c.tenant_id=$1 AND c.id=$2`, [context.tenantId, candidateId]);
      const row = detail.rows[0]!;
      const seen = await transaction.client.query<{ content_digest: string }>(
        "SELECT content_digest FROM memory_candidates WHERE tenant_id=$1 AND content_digest=$2 AND id<>$3", [context.tenantId, candidate.contentDigest, candidateId],
      );
      const findings = screen({ canonicalText: row.canonical_text, memoryClass: candidate.memoryClass,
        trustClass: row.signature && !row.signature_verified ? "authenticated" : candidate.trustClass, namespaceProtected: row.protected, sourceSignatureVerified: row.signature_verified,
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
      return {
        candidateId: updated.id, state: updated.state,
        findings: findings.map((finding) => ({ ruleId: finding.ruleId, severity: finding.severity, message: finding.message })),
      };
      } });
    }),
    evaluateCandidate: (context, input) => run(context, async (transaction) => {
      requireLifecycleRole(context);
      const candidateId = asString(input, "candidateId");
      return new LifecycleReceiptRepository(transaction).replay({ operation: "candidate.evaluate", resourceId: candidateId, idempotencyKey: asString(input, "idempotencyKey"), request: input, execute: async () => {
      const candidate = await new CandidateRepository(transaction).get(candidateId);
      if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
      await transaction.client.query("SELECT id FROM memory_candidates WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [context.tenantId, candidateId]);
      const existing = await transaction.client.query<{ id: string }>(
        `SELECT id FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='candidate.evaluation_requested' AND delivered_at IS NULL
         ORDER BY created_at ASC,id ASC LIMIT 1`, [context.tenantId, candidateId],
      );
      if (existing.rows[0]) return { candidateId, status: "queued", eventId: existing.rows[0].id };
      const running = await transaction.client.query<{ trigger_event_id: string | null; id: string }>(
        `SELECT id,trigger_event_id FROM evaluation_runs WHERE tenant_id=$1 AND candidate_id=$2 AND status IN ('pending','running')
         ORDER BY created_at DESC,id DESC LIMIT 1`, [context.tenantId, candidateId],
      );
      if (running.rows[0]) return { candidateId, status: "queued", eventId: running.rows[0].trigger_event_id ?? running.rows[0].id };
      if (candidate.state !== "evaluating") throw new DomainError("conflict", "Candidate is not ready for evaluation.");
      const event = await new OutboxRepository(transaction).enqueue({ eventType: "candidate.evaluation_requested",
        aggregateType: "memory_candidate", aggregateId: candidateId, payload: { tenantId: context.tenantId, candidateId } });
      await new AuditRepository(transaction).append({ actorId: context.principalId, action: "candidate.evaluation_requested",
        resourceType: "memory_candidate", resourceId: candidateId, requestId: context.requestId, safeDetails: { eventId: event.id } });
      return { candidateId, status: "queued", eventId: event.id };
      } });
    }),
    reviewCandidate: (context, input) => run(context, async (transaction) => {
      requireLifecycleRole(context);
      const evaluationRunId = asString(input, "evaluationRunId");
      const candidateId = asString(input, "candidateId");
      return new LifecycleReceiptRepository(transaction).replay({ operation: "candidate.review", resourceId: candidateId, idempotencyKey: asString(input, "idempotencyKey"), request: input, execute: async () => {
      const policy = await transaction.client.query<{ policy_version: string }>(
        "SELECT policy_version FROM evaluation_runs WHERE tenant_id=$1 AND id=$2", [context.tenantId, evaluationRunId],
      );
      if (!policy.rows[0]) throw new DomainError("not_found", "Evaluation was not found.");
      const reviewed = await decideReview(transaction, context, { candidateId, evaluationRunId,
        requestedDecision: asString(input, "decision") as "approved" | "rejected" | "quarantined",
        reason: asString(input, "reason"), policyVersion: policy.rows[0].policy_version });
      return { reviewId: reviewed.id, candidateId: reviewed.candidateId, decision: reviewed.decision,
        evaluationRunId: reviewed.evaluationRunId, baselineRevision: reviewed.baselineRevision, policyVersion: reviewed.policyVersion };
      } });
    }),
    promoteCandidate: (context, input) => run(context, async (transaction) => {
      requireLifecycleRole(context);
      const candidateId = asString(input, "candidateId");
      return new LifecycleReceiptRepository(transaction).replay({ operation: "candidate.promote", resourceId: candidateId, idempotencyKey: asString(input, "idempotencyKey"), request: input, execute: async () => {
      const version = await promoteCandidate(transaction, context, {
      candidateId, reviewId: asString(input, "reviewId"), stableKey: asString(input, "stableKey"),
      reason: asString(input, "reason"), idempotencyKey: asString(input, "idempotencyKey"),
      });
      return { memoryVersionId: version.id, lineageId: version.lineageId, candidateId: version.candidateId, revision: version.revision, version: version.version, active: version.active };
      } });
    }),
    rollbackLineage: (context, input) => run(context, async (transaction) => {
      requireLifecycleRole(context);
      const lineageId = asString(input, "lineageId");
      return new LifecycleReceiptRepository(transaction).replay({ operation: "lineage.rollback", resourceId: lineageId, idempotencyKey: asString(input, "idempotencyKey"), request: input, execute: async () => {
      const version = await rollbackMemory(transaction, context, {
      lineageId, targetVersionId: asString(input, "targetVersionId"),
      reason: asString(input, "reason"), idempotencyKey: asString(input, "idempotencyKey"),
      });
      return { memoryVersionId: version.id, lineageId: version.lineageId, candidateId: version.candidateId, revision: version.revision, version: version.version, active: version.active };
      } });
    }),
    searchMemory: (context, input) => run(context, (transaction) => retrieveActiveMemory(transaction, context, {
      namespaceId: asString(input, "namespaceId"), query: asString(input, "query"), purpose: asString(input, "purpose"),
      revision: typeof input.revision === "number" ? input.revision : undefined,
    }, embeddings)),
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
