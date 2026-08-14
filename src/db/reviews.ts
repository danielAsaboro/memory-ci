import { DomainError } from "../domain/errors";
import type { ReviewBinding } from "../domain/types";
import type { TenantTransaction } from "./client";

export type Review = ReviewBinding & Readonly<{
  id: string; candidateId: string; reviewerId: string;
  decision: "approved" | "rejected" | "quarantined"; reason: string;
}>;

type ReviewRow = {
  id: string; candidate_id: string; reviewer_id: string; decision: Review["decision"];
  candidate_digest: string; evaluation_run_id: string; baseline_revision: string;
  policy_version: string; reason: string;
};

const mapReview = (row: ReviewRow): Review => ({
  id: row.id, candidateId: row.candidate_id, reviewerId: row.reviewer_id, decision: row.decision,
  candidateDigest: row.candidate_digest, evaluationRunId: row.evaluation_run_id,
  baselineRevision: Number(row.baseline_revision), policyVersion: row.policy_version, reason: row.reason,
});

export class ReviewRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async decide(input: Review): Promise<Review> {
    const result = await this.transaction.client.query<ReviewRow>(
      `INSERT INTO reviews
       (tenant_id,id,candidate_id,reviewer_id,decision,candidate_digest,evaluation_run_id,baseline_revision,policy_version,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [this.transaction.tenantId, input.id, input.candidateId, input.reviewerId, input.decision,
        input.candidateDigest, input.evaluationRunId, input.baselineRevision, input.policyVersion, input.reason],
    );
    return mapReview(result.rows[0]!);
  }

  async assertFresh(candidateId: string, reviewId: string): Promise<Review> {
    const result = await this.transaction.client.query<ReviewRow & {
      current_digest: string; current_revision: string; run_status: string; run_baseline: string; run_policy: string;
    }>(
      `SELECT r.*, c.content_digest AS current_digest, n.current_revision,
              e.status AS run_status, e.baseline_revision AS run_baseline, e.policy_version AS run_policy
       FROM reviews r
       JOIN memory_candidates c ON c.tenant_id=r.tenant_id AND c.id=r.candidate_id
       JOIN agent_namespaces n ON n.tenant_id=c.tenant_id AND n.id=c.namespace_id
       JOIN evaluation_runs e ON e.tenant_id=r.tenant_id AND e.id=r.evaluation_run_id
       WHERE r.tenant_id=$1 AND r.id=$2 AND r.candidate_id=$3`,
      [this.transaction.tenantId, reviewId, candidateId],
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("not_found", "Review was not found.");
    const stale = row.decision !== "approved" || row.current_digest !== row.candidate_digest ||
      Number(row.current_revision) !== Number(row.baseline_revision) || row.run_status !== "passed" ||
      Number(row.run_baseline) !== Number(row.baseline_revision) || row.run_policy !== row.policy_version;
    if (stale) throw new DomainError("stale_review", "Review is stale and must be repeated against the current baseline.");
    return mapReview(row);
  }
}
