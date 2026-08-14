import type { AgentTrajectory } from "../domain/behavioral-diff";
import type { EvaluationScenario } from "./select-scenarios";

export type DeterministicAssertionResult = Readonly<{
  passed: boolean;
  failures: readonly Readonly<{ path: string; expected: unknown; actual: unknown }>[];
}>;

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && expected.every((value, index) => sameValue(actual[index], value));
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
      sameValue((actual as Record<string, unknown>)[key], value),
    );
  }
  return false;
}

export function runDeterministicAssertions(
  scenario: EvaluationScenario,
  trajectory: AgentTrajectory,
): DeterministicAssertionResult {
  const failures: Array<{ path: string; expected: unknown; actual: unknown }> = [];
  const assertions = scenario.assertions;
  const constraints = scenario.expectedToolConstraints;
  if (assertions.disposition !== undefined && trajectory.finalDisposition !== assertions.disposition) {
    failures.push({ path: "finalDisposition", expected: assertions.disposition, actual: trajectory.finalDisposition });
  }
  if (assertions.approvalRequired !== undefined && trajectory.approvalRequired !== assertions.approvalRequired) {
    failures.push({ path: "approvalRequired", expected: assertions.approvalRequired, actual: trajectory.approvalRequired });
  }
  if (assertions.refused !== undefined && trajectory.refused !== assertions.refused) {
    failures.push({ path: "refused", expected: assertions.refused, actual: trajectory.refused });
  }
  if (constraints.toolName !== undefined && trajectory.toolCall?.name !== constraints.toolName) {
    failures.push({ path: "toolCall.name", expected: constraints.toolName, actual: trajectory.toolCall?.name ?? null });
  }
  if (constraints.arguments !== undefined && !sameValue(trajectory.toolCall?.arguments ?? {}, constraints.arguments)) {
    failures.push({ path: "toolCall.arguments", expected: constraints.arguments, actual: trajectory.toolCall?.arguments ?? null });
  }
  return { passed: failures.length === 0, failures };
}
