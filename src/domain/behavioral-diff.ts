export type FinalDisposition = "approve" | "deny" | "abstain" | "respond";

export type ToolCall = Readonly<{
  name: string;
  arguments: Readonly<Record<string, unknown>>;
}>;

export type AgentTrajectory = Readonly<{
  finalDisposition: FinalDisposition;
  selectedMemoryIds: readonly string[];
  toolCall?: ToolCall;
  approvalRequired: boolean;
  refused: boolean;
}>;

export type ValueChange = Readonly<{
  path: string;
  before: unknown;
  after: unknown;
}>;

export type BehavioralDiff = Readonly<{
  hasBehavioralChange: boolean;
  memorySelection: Readonly<{ added: readonly string[]; removed: readonly string[] }>;
  disposition: Readonly<{ before: FinalDisposition; after: FinalDisposition }> | null;
  toolName: Readonly<{ before: string | null; after: string | null }> | null;
  toolArgumentChanges: readonly ValueChange[];
  approvalRequirement: Readonly<{ before: boolean; after: boolean }> | null;
  refusal: Readonly<{ before: boolean; after: boolean }> | null;
}>;

function sortedDifference(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    return keys.every((key) => key in left && key in right && sameValue(left[key], right[key]));
  }
  return false;
}

function diffValues(before: unknown, after: unknown, path = ""): ValueChange[] {
  if (sameValue(before, after)) return [];

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValues(before[key], after[key], path ? `${path}.${key}` : key));
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_, index) =>
      diffValues(before[index], after[index], path ? `${path}.${index}` : String(index)),
    ).flat();
  }

  return [{ path, before, after }];
}

export function diffBehavior(baseline: AgentTrajectory, candidate: AgentTrajectory): BehavioralDiff {
  const disposition =
    baseline.finalDisposition === candidate.finalDisposition
      ? null
      : { before: baseline.finalDisposition, after: candidate.finalDisposition };
  const baselineToolName = baseline.toolCall?.name ?? null;
  const candidateToolName = candidate.toolCall?.name ?? null;
  const toolName =
    baselineToolName === candidateToolName ? null : { before: baselineToolName, after: candidateToolName };
  const toolArgumentChanges = diffValues(baseline.toolCall?.arguments ?? {}, candidate.toolCall?.arguments ?? {});
  const approvalRequirement =
    baseline.approvalRequired === candidate.approvalRequired
      ? null
      : { before: baseline.approvalRequired, after: candidate.approvalRequired };
  const refusal = baseline.refused === candidate.refused ? null : { before: baseline.refused, after: candidate.refused };

  return {
    hasBehavioralChange: Boolean(disposition || toolName || toolArgumentChanges.length || approvalRequirement || refusal),
    memorySelection: {
      added: sortedDifference(candidate.selectedMemoryIds, baseline.selectedMemoryIds),
      removed: sortedDifference(baseline.selectedMemoryIds, candidate.selectedMemoryIds),
    },
    disposition,
    toolName,
    toolArgumentChanges,
    approvalRequirement,
    refusal,
  };
}
