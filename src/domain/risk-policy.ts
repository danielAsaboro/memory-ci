import type { MemoryClass, TrustClass } from "./types";
import type { FindingSeverity, ScreeningFinding } from "./screening";

export type RiskLevel = FindingSeverity;
export type AutoDisposition = "none" | "quarantine" | "reject";

export type RiskInput = Readonly<{
  memoryClass: MemoryClass;
  trustClass: TrustClass;
  findings: readonly ScreeningFinding[];
  behavioralChange: boolean;
}>;

export type RiskDecision = Readonly<{
  risk: RiskLevel;
  requiredApprovals: 0 | 1 | 2;
  autoDisposition: AutoDisposition;
  reasons: readonly string[];
}>;

const riskWeight: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const actionGoverningClasses = new Set<MemoryClass>(["policy", "constraint", "skill"]);
const quarantineRules = new Set<ScreeningFinding["ruleId"]>([
  "secret_material",
  "untrusted_tool_directive",
  "protected_memory_mutation",
]);

export function evaluateRisk(input: RiskInput): RiskDecision {
  let risk: RiskLevel = "low";
  const reasons: string[] = [];

  for (const finding of input.findings) {
    reasons.push(finding.ruleId);
    if (riskWeight[finding.severity] > riskWeight[risk]) {
      risk = finding.severity;
    }
  }

  if (input.behavioralChange) {
    reasons.push("behavioral_change");
    if (riskWeight[risk] < riskWeight.high) risk = "high";
  }

  const actionGoverning = actionGoverningClasses.has(input.memoryClass);
  if (actionGoverning) {
    reasons.push("action_governing_memory");
    if (riskWeight[risk] < riskWeight.high) risk = "high";
  }

  const mustQuarantine = input.findings.some((finding) => quarantineRules.has(finding.ruleId));
  if (mustQuarantine) {
    return {
      risk: "critical",
      requiredApprovals: 0,
      autoDisposition: "quarantine",
      reasons: [...new Set(reasons)],
    };
  }

  const requiredApprovals: 0 | 1 | 2 =
    risk === "critical" || (risk === "high" && actionGoverning && input.behavioralChange)
      ? 2
      : risk === "high" || risk === "medium" || actionGoverning || input.trustClass === "untrusted"
        ? 1
        : 0;

  return {
    risk,
    requiredApprovals,
    autoDisposition: "none",
    reasons: [...new Set(reasons)],
  };
}
