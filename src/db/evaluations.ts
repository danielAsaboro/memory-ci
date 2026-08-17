import { DomainError } from "../domain/errors";
import type { TenantTransaction } from "./client";

export type EvaluationStatus = "pending" | "running" | "passed" | "regressed" | "inconclusive" | "failed";
export type EvaluationRun = Readonly<{
  id: string; candidateId: string; baselineRevision: number; policyVersion: string; status: EvaluationStatus;
  modelId: string | null; providerRequestId: string | null; triggerEventId: string | null;
}>;

type EvaluationRow = {
  id: string; candidate_id: string; baseline_revision: string; policy_version: string;
  status: EvaluationStatus; model_id: string | null; provider_request_id: string | null; trigger_event_id: string | null;
};

const mapRun = (row: EvaluationRow): EvaluationRun => ({
  id: row.id, candidateId: row.candidate_id, baselineRevision: Number(row.baseline_revision),
  policyVersion: row.policy_version, status: row.status, modelId: row.model_id,
  providerRequestId: row.provider_request_id, triggerEventId: row.trigger_event_id,
});

export class EvaluationRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async createRun(input: { id: string; candidateId: string; baselineRevision: number; policyVersion: string; triggerEventId?: string }): Promise<EvaluationRun> {
    const result = await this.transaction.client.query<EvaluationRow>(
      `INSERT INTO evaluation_runs
       (tenant_id, id, candidate_id, baseline_revision, policy_version, trigger_event_id, status, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'running',now()) RETURNING *`,
      [this.transaction.tenantId, input.id, input.candidateId, input.baselineRevision, input.policyVersion, input.triggerEventId ?? null],
    );
    return mapRun(result.rows[0]!);
  }

  async recordResult(input: {
    id: string; runId: string; scenarioId?: string; scope?: "scenario" | "suite"; status: Exclude<EvaluationStatus, "pending" | "running">;
    baselineTrajectory: unknown; candidateTrajectory: unknown; behavioralDiff: unknown;
    deterministicAssertions: unknown; semanticJudgment?: unknown; artifactUri?: string; providerRequestId?: string;
  }): Promise<void> {
    await this.transaction.client.query(
      `INSERT INTO evaluation_results
       (tenant_id,id,evaluation_run_id,scenario_id,result_scope,status,baseline_trajectory,candidate_trajectory,
        behavioral_diff,deterministic_assertions,semantic_judgment,artifact_uri,provider_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [this.transaction.tenantId, input.id, input.runId, input.scenarioId ?? null, input.scope ?? "scenario", input.status,
        input.baselineTrajectory, input.candidateTrajectory, input.behavioralDiff,
        input.deterministicAssertions, input.semanticJudgment ?? null, input.artifactUri ?? null,
        input.providerRequestId ?? null],
    );
  }

  async completeRun(id: string, status: Exclude<EvaluationStatus, "pending" | "running">, metadata: { modelId?: string; providerRequestId?: string }): Promise<EvaluationRun> {
    const result = await this.transaction.client.query<EvaluationRow>(
      `UPDATE evaluation_runs SET status=$3, model_id=$4, provider_request_id=$5, completed_at=now()
       WHERE tenant_id=$1 AND id=$2 AND status IN ('pending','running') RETURNING *`,
      [this.transaction.tenantId, id, status, metadata.modelId ?? null, metadata.providerRequestId ?? null],
    );
    if (!result.rows[0]) throw new DomainError("conflict", "Evaluation run is missing or already complete.");
    return mapRun(result.rows[0]);
  }
}
