import { issueSandboxRefund } from "../aws/sandbox-refund";
import type { AgentTrajectory } from "../domain/behavioral-diff";
import { DomainError } from "../domain/errors";
import type { EvaluationScenario } from "../services/select-scenarios";

export async function handler(event: Parameters<typeof issueSandboxRefund>[0]) {
  return issueSandboxRefund(event);
}

/**
 * Executes the tool-shaped part of an evaluation against the non-monetary
 * sandbox.  The receipt is intentionally awaited: callers must not mark the
 * scenario complete unless its external evidence has been persisted.
 */
export async function runSandboxTrajectory(input: {
  tenantId: string; candidateId: string; memoryRevision: number; scenario: EvaluationScenario;
  revision: { kind: "baseline"; revision: number } | { kind: "candidate"; candidateId: string };
}): Promise<AgentTrajectory> {
  const constraints = input.scenario.expectedToolConstraints;
  const toolName = typeof constraints.toolName === "string" ? constraints.toolName : undefined;
  if (toolName !== "issue_sandbox_refund") throw new DomainError("inconclusive", "Scenario tool execution is unsupported.");
  const observedInput = input.scenario.inputPayload;
  const receipt = await issueSandboxRefund({
      tenantId: input.tenantId, caseId: String(input.scenario.inputPayload.caseId ?? input.scenario.id),
      amount: Number(observedInput.amount ?? 1),
      currency: String(observedInput.currency ?? "USD"),
      destination: String(observedInput.destination ?? "original"),
      idempotencyKey: `evaluation:${input.candidateId}:${input.scenario.id}:${input.revision.kind}`,
      memoryRevision: Math.max(1, input.memoryRevision),
    });
  return {
    finalDisposition: receipt.status === "simulated" ? "approve" : "abstain",
    selectedMemoryIds: input.revision.kind === "candidate" ? [input.candidateId] : [],
    toolCall: { name: toolName, arguments: { amount: receipt.amount, currency: receipt.currency, destination: receipt.destination, caseId: receipt.caseId } },
    approvalRequired: false, refused: false,
  };
}
