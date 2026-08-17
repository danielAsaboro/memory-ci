import { createHash } from "node:crypto";

import type { BedrockResult } from "../aws/bedrock";
import type { SemanticEvaluation } from "../contracts/bedrock";
import type { AgentTrajectory } from "../domain/behavioral-diff";
import { diffBehavior } from "../domain/behavioral-diff";
import { DomainError } from "../domain/errors";
import type { Candidate, CandidateState, TenantContext } from "../domain/types";
import type { EvaluationRun, EvaluationStatus } from "../db/evaluations";
import { canonicalJson } from "./provenance";
import { runDeterministicAssertions } from "./run-scenario";
import type { EvaluationScenario } from "./select-scenarios";

type EvaluationPort = {
  createRun(input: { id: string; candidateId: string; baselineRevision: number; policyVersion: string }): Promise<EvaluationRun>;
  recordResult(input: {
    id: string; runId: string; scenarioId: string; status: Exclude<EvaluationStatus, "pending" | "running">;
    baselineTrajectory: unknown; candidateTrajectory: unknown; behavioralDiff: unknown;
    deterministicAssertions: unknown; semanticJudgment?: unknown; artifactUri?: string; providerRequestId?: string;
  }): Promise<void>;
  completeRun(id: string, status: Exclude<EvaluationStatus, "pending" | "running">,
    metadata: { modelId?: string; providerRequestId?: string }): Promise<EvaluationRun>;
};

export type EvaluationDependencies = Readonly<{
  candidates: {
    get(id: string): Promise<Candidate | null>;
    transition(id: string, state: CandidateState): Promise<Candidate>;
  };
  namespaces: { currentRevision(namespaceId: string): Promise<number> };
  scenarios: { select(candidateId: string, limit: number): Promise<EvaluationScenario[]> };
  evaluations: EvaluationPort;
  trajectories: {
    run(scenario: EvaluationScenario, revision: { kind: "baseline"; revision: number } | { kind: "candidate"; candidateId: string }): Promise<AgentTrajectory>;
  };
  semanticJudge(input: { scenarioName: string; behavioralDiff: unknown }): Promise<BedrockResult<SemanticEvaluation>>;
  artifacts: { put(input: { digest: string; body: string; mediaType: "application/json" }): Promise<string> };
  policyVersion: string;
  modelId: string;
  providerRequestId?: string;
  id(): string;
  scenarioLimit?: number;
}>;

export type EvaluationReceipt = Readonly<{
  id: string; candidateId: string; status: Exclude<EvaluationStatus, "pending" | "running" | "failed">;
  baselineRevision: number; scenarioCount: number;
}>;

const severity = { passed: 0, inconclusive: 1, regressed: 2 } as const;

export async function evaluateCandidate(
  _context: TenantContext,
  candidateId: string,
  dependencies: EvaluationDependencies,
): Promise<EvaluationReceipt> {
  const candidate = await dependencies.candidates.get(candidateId);
  if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
  if (candidate.state !== "evaluating") throw new DomainError("conflict", "Candidate is not ready for evaluation.");
  const baselineRevision = await dependencies.namespaces.currentRevision(candidate.namespaceId);
  const run = await dependencies.evaluations.createRun({
    id: dependencies.id(), candidateId, baselineRevision, policyVersion: dependencies.policyVersion,
  });
  const scenarios = await dependencies.scenarios.select(candidateId, dependencies.scenarioLimit ?? 20);
  if (!scenarios.length) {
    await dependencies.evaluations.completeRun(run.id, "inconclusive", { modelId: dependencies.modelId, providerRequestId: dependencies.providerRequestId });
    await dependencies.candidates.transition(candidateId, "quarantined");
    return { id: run.id, candidateId, status: "inconclusive", baselineRevision, scenarioCount: 0 };
  }

  let aggregate: keyof typeof severity = "passed";
  let lastProviderRequestId: string | undefined;
  for (const scenario of scenarios) {
    const baselineTrajectory = await dependencies.trajectories.run(scenario, { kind: "baseline", revision: baselineRevision });
    const candidateTrajectory = await dependencies.trajectories.run(scenario, { kind: "candidate", candidateId });
    const behavioralDiff = diffBehavior(baselineTrajectory, candidateTrajectory);
    const deterministicAssertions = runDeterministicAssertions(scenario, candidateTrajectory);
    let status: keyof typeof severity = deterministicAssertions.passed ? "passed" : "regressed";
    let semanticJudgment: SemanticEvaluation | undefined;
    if (deterministicAssertions.passed && (behavioralDiff.hasBehavioralChange || behavioralDiff.memorySelection.added.length > 0 || behavioralDiff.memorySelection.removed.length > 0)) {
      const judged = await dependencies.semanticJudge({ scenarioName: scenario.name, behavioralDiff });
      lastProviderRequestId = judged.providerRequestId ?? undefined;
      if (judged.status === "complete") {
        semanticJudgment = judged.value;
        status = judged.value.status;
      } else {
        status = "inconclusive";
      }
    }
    if (severity[status] > severity[aggregate]) aggregate = status;
    const artifact = {
      candidateId, scenarioId: scenario.id, baselineRevision, baselineTrajectory,
      candidateTrajectory, behavioralDiff, deterministicAssertions, semanticJudgment: semanticJudgment ?? null,
    };
    const body = canonicalJson(artifact);
    const digest = createHash("sha256").update(body).digest("hex");
    const artifactUri = await dependencies.artifacts.put({ digest, body, mediaType: "application/json" });
    await dependencies.evaluations.recordResult({
      id: dependencies.id(), runId: run.id, scenarioId: scenario.id, status,
      baselineTrajectory, candidateTrajectory, behavioralDiff, deterministicAssertions,
      semanticJudgment, artifactUri, providerRequestId: lastProviderRequestId,
    });
  }

  await dependencies.evaluations.completeRun(run.id, aggregate, {
    modelId: dependencies.modelId, providerRequestId: dependencies.providerRequestId ?? lastProviderRequestId,
  });
  await dependencies.candidates.transition(candidateId, aggregate === "passed" ? "review_required" : "quarantined");
  return { id: run.id, candidateId, status: aggregate, baselineRevision, scenarioCount: scenarios.length };
}
