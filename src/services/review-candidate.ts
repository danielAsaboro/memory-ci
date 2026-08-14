import { randomUUID } from "node:crypto";

import { AuditRepository } from "../db/audit";
import { CandidateRepository } from "../db/candidates";
import type { TenantTransaction } from "../db/client";
import { ReviewRepository, type Review } from "../db/reviews";
import { DomainError } from "../domain/errors";
import type { TenantContext } from "../domain/types";

export async function decideReview(
  transaction: TenantTransaction,
  context: TenantContext,
  input: {
    candidateId: string; evaluationRunId: string; requestedDecision: Review["decision"];
    reason: string; policyVersion: string;
  },
): Promise<Review> {
  const candidate = await new CandidateRepository(transaction).get(input.candidateId);
  if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
  if (candidate.state !== "review_required") throw new DomainError("conflict", "Candidate is not awaiting review.");
  const evidence = await transaction.client.query<{
    baseline_revision: string; policy_version: string; status: string; blocking_findings: string;
  }>(
    `SELECT e.baseline_revision,e.policy_version,e.status,
            count(f.id) FILTER (WHERE f.severity IN ('high','critical')) AS blocking_findings
     FROM evaluation_runs e
     LEFT JOIN screening_findings f ON f.tenant_id=e.tenant_id AND f.candidate_id=e.candidate_id
     WHERE e.tenant_id=$1 AND e.id=$2 AND e.candidate_id=$3
     GROUP BY e.baseline_revision,e.policy_version,e.status`,
    [transaction.tenantId, input.evaluationRunId, input.candidateId],
  );
  const row = evidence.rows[0];
  if (!row) throw new DomainError("not_found", "Evaluation evidence was not found.");
  if (row.policy_version !== input.policyVersion) throw new DomainError("stale_review", "Review policy version does not match evaluation evidence.");
  const blocked = Number(row.blocking_findings) > 0 || row.status !== "passed";
  const decision: Review["decision"] = blocked ? "quarantined" : input.requestedDecision;
  const review = await new ReviewRepository(transaction).decide({
    id: randomUUID(), candidateId: input.candidateId, reviewerId: context.principalId, decision,
    candidateDigest: candidate.contentDigest, evaluationRunId: input.evaluationRunId,
    baselineRevision: Number(row.baseline_revision), policyVersion: row.policy_version, reason: input.reason,
  });
  await new CandidateRepository(transaction).transition(input.candidateId,
    decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "quarantined");
  await new AuditRepository(transaction).append({
    actorId: context.principalId, action: `candidate.${decision}`, resourceType: "memory_candidate",
    resourceId: input.candidateId, requestId: context.requestId,
    safeDetails: { reviewId: review.id, evaluationRunId: input.evaluationRunId, blockedByPolicy: blocked },
  });
  return review;
}
