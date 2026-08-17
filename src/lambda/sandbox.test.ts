import { describe, expect, it } from "vitest";

import { runSandboxTrajectory } from "./sandbox";

describe("sandbox evaluation adapter", () => {
  it("records a sandbox receipt before returning an expected refund trajectory", async () => {
    const trajectory = await runSandboxTrajectory({
      tenantId: "tenant-1", candidateId: "candidate-1", memoryRevision: 3,
      scenario: { id: "scenario-1", name: "Original refund", inputPayload: { caseId: "case-1", amount: 45, currency: "USD" }, assertions: { disposition: "approve" }, expectedToolConstraints: { toolName: "issue_sandbox_refund", arguments: { amount: 45, destination: "original" } }, namespaceId: "namespace-1", distance: 0 },
      revision: { kind: "candidate", candidateId: "candidate-1" },
    });
    expect(trajectory).toMatchObject({ finalDisposition: "approve", selectedMemoryIds: ["candidate-1"], toolCall: { name: "issue_sandbox_refund", arguments: { destination: "original" } } });
    expect(trajectory.toolCall?.arguments).not.toHaveProperty("receiptId");
  });

  it("uses observed scenario input rather than echoing an expected tool destination", async () => {
    const trajectory = await runSandboxTrajectory({ tenantId: "tenant-1", candidateId: "candidate-1", memoryRevision: 3,
      scenario: { id: "scenario-2", name: "Observed refund", inputPayload: { caseId: "case-2", amount: 20, currency: "USD", destination: "original" }, assertions: {}, expectedToolConstraints: { toolName: "issue_sandbox_refund", arguments: { destination: "gift-card:attacker" } }, namespaceId: "namespace-1", distance: 0 }, revision: { kind: "candidate", candidateId: "candidate-1" } });
    expect(trajectory.toolCall?.arguments).toMatchObject({ amount: 20, destination: "original" });
  });

  it("marks unsupported tools inconclusive instead of fabricating expected execution", async () => {
    await expect(runSandboxTrajectory({ tenantId: "tenant-1", candidateId: "candidate-1", memoryRevision: 3,
      scenario: { id: "scenario-3", name: "Unsupported", inputPayload: {}, assertions: {}, expectedToolConstraints: { toolName: "not_a_refund", arguments: {} }, namespaceId: "namespace-1", distance: 0 }, revision: { kind: "candidate", candidateId: "candidate-1" } })).rejects.toMatchObject({ code: "inconclusive" });
  });
});
