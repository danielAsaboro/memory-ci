import { describe, expect, it } from "vitest";

import { diffBehavior } from "./behavioral-diff";

describe("diffBehavior", () => {
  it("detects a changed side-effect argument", () => {
    const diff = diffBehavior(
      {
        finalDisposition: "approve",
        selectedMemoryIds: ["policy-v1"],
        toolCall: { name: "issue_sandbox_refund", arguments: { amount: 45, destination: "original" } },
        approvalRequired: false,
        refused: false,
      },
      {
        finalDisposition: "approve",
        selectedMemoryIds: ["candidate-poison"],
        toolCall: { name: "issue_sandbox_refund", arguments: { destination: "gift-card:attacker", amount: 45 } },
        approvalRequired: false,
        refused: false,
      },
    );

    expect(diff.hasBehavioralChange).toBe(true);
    expect(diff.toolArgumentChanges).toEqual([
      { path: "destination", before: "original", after: "gift-card:attacker" },
    ]);
    expect(diff.memorySelection).toEqual({ added: ["candidate-poison"], removed: ["policy-v1"] });
  });

  it("ignores object key ordering when tool arguments are equivalent", () => {
    const diff = diffBehavior(
      {
        finalDisposition: "approve",
        selectedMemoryIds: ["policy-v1"],
        toolCall: { name: "issue_sandbox_refund", arguments: { amount: 45, metadata: { currency: "USD" } } },
        approvalRequired: false,
        refused: false,
      },
      {
        finalDisposition: "approve",
        selectedMemoryIds: ["policy-v1"],
        toolCall: { name: "issue_sandbox_refund", arguments: { metadata: { currency: "USD" }, amount: 45 } },
        approvalRequired: false,
        refused: false,
      },
    );

    expect(diff.hasBehavioralChange).toBe(false);
    expect(diff.toolArgumentChanges).toEqual([]);
  });

  it("reports approval and refusal changes independently", () => {
    const diff = diffBehavior(
      {
        finalDisposition: "abstain",
        selectedMemoryIds: ["constraint-v1"],
        approvalRequired: true,
        refused: true,
      },
      {
        finalDisposition: "approve",
        selectedMemoryIds: ["candidate-v2"],
        approvalRequired: false,
        refused: false,
      },
    );

    expect(diff.disposition).toEqual({ before: "abstain", after: "approve" });
    expect(diff.approvalRequirement).toEqual({ before: true, after: false });
    expect(diff.refusal).toEqual({ before: true, after: false });
    expect(diff.hasBehavioralChange).toBe(true);
  });

  it("does not classify citation-only changes as behavioral changes", () => {
    const diff = diffBehavior(
      {
        finalDisposition: "respond",
        selectedMemoryIds: ["fact-v1"],
        approvalRequired: false,
        refused: false,
      },
      {
        finalDisposition: "respond",
        selectedMemoryIds: ["fact-v1", "fact-v2"],
        approvalRequired: false,
        refused: false,
      },
    );

    expect(diff.memorySelection).toEqual({ added: ["fact-v2"], removed: [] });
    expect(diff.hasBehavioralChange).toBe(false);
  });
});
