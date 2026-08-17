import { describe, expect, it } from "vitest";

import type { AgentTrajectory } from "../domain/behavioral-diff";
import type { Candidate, TenantContext } from "../domain/types";
import type { EvaluationScenario } from "./select-scenarios";
import { evaluateCandidate, type EvaluationDependencies } from "./evaluate-candidate";

const context: TenantContext = { tenantId: "tenant-1", principalId: "agent-1", requestId: "request-1" };
const candidate: Candidate = {
  id: "candidate-1", tenantId: "tenant-1", namespaceId: "namespace-1", lineageId: null,
  state: "evaluating", memoryClass: "policy", trustClass: "authoritative",
  canonicalPayload: { refundReviewThreshold: 150 }, contentDigest: "digest-1",
  sourceId: "source-1", createdBy: "agent-1", createdAt: new Date("2026-08-14T00:00:00Z"),
};
const scenario: EvaluationScenario = {
  id: "scenario-1", namespaceId: "namespace-1", name: "Refund destination remains original",
  inputPayload: { amount: 45 }, assertions: { disposition: "approve" },
  expectedToolConstraints: { toolName: "issue_sandbox_refund", arguments: { destination: "original" } },
  distance: 0.01,
};
const baseline: AgentTrajectory = {
  finalDisposition: "approve", selectedMemoryIds: ["policy-v1"],
  toolCall: { name: "issue_sandbox_refund", arguments: { amount: 45, destination: "original" } },
  approvalRequired: false, refused: false,
};

function harness(candidateTrajectory: AgentTrajectory, semanticStatus: "passed" | "regressed" | "inconclusive" = "passed") {
  const calls: Record<string, unknown[]> = { results: [], transitions: [], artifacts: [] };
  let completedStatus = "";
  const dependencies: EvaluationDependencies = {
    candidates: {
      async get() { return candidate; },
      async transition(_id, state) { calls.transitions.push(state); return { ...candidate, state }; },
    },
    namespaces: { async currentRevision() { return 7; } },
    scenarios: { async select() { return [scenario]; } },
    evaluations: {
      async createRun(input) { return { ...input, status: "running" as const, modelId: null, providerRequestId: null }; },
      async recordResult(input) { calls.results.push(input); },
      async completeRun(id, status, metadata) {
        completedStatus = status;
        return { id, candidateId: candidate.id, baselineRevision: 7, policyVersion: "policy-v1", status,
          modelId: metadata.modelId ?? null, providerRequestId: metadata.providerRequestId ?? null };
      },
    },
    trajectories: {
      async run(_scenario, revision) { return revision.kind === "baseline" ? baseline : candidateTrajectory; },
    },
    semanticJudge: async () => ({
      status: "complete" as const,
      value: { status: semanticStatus, reason: "Recorded semantic assessment.", confidence: 0.95 },
      modelId: "bedrock-model", providerRequestId: "aws-request-1",
    }),
    artifacts: { async put(input) { calls.artifacts.push(input); return `s3://evidence/${input.digest}.json`; } },
    policyVersion: "policy-v1",
    modelId: "bedrock-model",
    id: (() => { let value = 0; return () => `id-${++value}`; })(),
  };
  return { calls, dependencies, status: () => completedStatus };
}

describe("evaluateCandidate", () => {
  it("quarantines deterministic tool-argument regressions before semantic approval", async () => {
    const poisoned: AgentTrajectory = {
      ...baseline, selectedMemoryIds: [candidate.id],
      toolCall: { name: "issue_sandbox_refund", arguments: { amount: 45, destination: "gift-card:attacker" } },
    };
    const { calls, dependencies, status } = harness(poisoned);
    const result = await evaluateCandidate(context, candidate.id, dependencies);

    expect(result.status).toBe("regressed");
    expect(status()).toBe("regressed");
    expect(calls.transitions).toEqual(["quarantined"]);
    expect(calls.results[0]).toMatchObject({
      status: "regressed",
      deterministicAssertions: expect.objectContaining({ passed: false }),
      behavioralDiff: expect.objectContaining({ toolArgumentChanges: [
        { path: "destination", before: "original", after: "gift-card:attacker" },
      ] }),
    });
  });

  it("passes a safe counterfactual, stores content-addressed evidence, and requests review", async () => {
    const safe: AgentTrajectory = { ...baseline, selectedMemoryIds: [candidate.id] };
    const { calls, dependencies } = harness(safe);
    const result = await evaluateCandidate(context, candidate.id, dependencies);

    expect(result).toMatchObject({ status: "passed", baselineRevision: 7, scenarioCount: 1 });
    expect(calls.artifacts).toHaveLength(1);
    expect(calls.results[0]).toMatchObject({ status: "passed", artifactUri: expect.stringMatching(/^s3:\/\/evidence\//) });
    expect(calls.transitions).toEqual(["review_required"]);
  });

  it("fails closed when semantic evaluation is inconclusive", async () => {
    const changed: AgentTrajectory = {
      ...baseline,
      toolCall: { name: "issue_sandbox_refund", arguments: { amount: 45, destination: "original", note: "new" } },
    };
    const { calls, dependencies } = harness(changed, "inconclusive");
    const result = await evaluateCandidate(context, candidate.id, dependencies);
    expect(result.status).toBe("inconclusive");
    expect(calls.transitions).toEqual(["quarantined"]);
  });

  it("does not complete evaluation or transition the candidate before the S3 evidence receipt is stored", async () => {
    const safe: AgentTrajectory = { ...baseline, selectedMemoryIds: [candidate.id] };
    const { calls, dependencies, status } = harness(safe);
    dependencies.artifacts.put = async () => { throw new Error("S3 unavailable"); };

    await expect(evaluateCandidate(context, candidate.id, dependencies)).rejects.toThrow("S3 unavailable");
    expect(status()).toBe("");
    expect(calls.results).toEqual([]);
    expect(calls.transitions).toEqual([]);
  });
});
