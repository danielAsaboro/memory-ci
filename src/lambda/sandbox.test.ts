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
  });
});
