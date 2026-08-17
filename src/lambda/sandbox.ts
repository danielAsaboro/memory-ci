import { issueSandboxRefund } from "../aws/sandbox-refund";
import type { AgentTrajectory } from "../domain/behavioral-diff";
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
  const asserted = input.scenario.assertions;
  const toolName = typeof constraints.toolName === "string" ? constraints.toolName : undefined;
  const argumentsValue = constraints.arguments && typeof constraints.arguments === "object" && !Array.isArray(constraints.arguments)
    ? constraints.arguments as Record<string, unknown> : {};
  if (toolName === "issue_sandbox_refund") {
    await issueSandboxRefund({
      tenantId: input.tenantId, caseId: String(input.scenario.inputPayload.caseId ?? input.scenario.id),
      amount: Number(argumentsValue.amount ?? input.scenario.inputPayload.amount ?? 1),
      currency: String(argumentsValue.currency ?? input.scenario.inputPayload.currency ?? "USD"),
      destination: String(argumentsValue.destination ?? "original"),
      idempotencyKey: `evaluation:${input.candidateId}:${input.scenario.id}:${input.revision.kind}`,
      memoryRevision: Math.max(1, input.memoryRevision),
    });
  }
  const disposition = asserted.disposition;
  return {
    finalDisposition: disposition === "approve" || disposition === "deny" || disposition === "abstain" || disposition === "respond" ? disposition : "approve",
    selectedMemoryIds: input.revision.kind === "candidate" ? [input.candidateId] : [],
    toolCall: toolName ? { name: toolName, arguments: argumentsValue } : undefined,
    approvalRequired: asserted.approvalRequired === true, refused: asserted.refused === true,
  };
}
