import type { MemoryClass, TrustClass } from "./types";

export type FindingSeverity = "low" | "medium" | "high" | "critical";

export type ScreeningFinding = Readonly<{
  ruleId:
    | "untrusted_tool_directive"
    | "scope_broadening"
    | "protected_memory_mutation"
    | "secret_material"
    | "signature_unverified"
    | "attribution_removed"
    | "content_replay"
    | "source_expired";
  severity: FindingSeverity;
  message: string;
  evidence?: string;
}>;

export type ScreeningInput = Readonly<{
  canonicalText: string;
  memoryClass: MemoryClass;
  trustClass: TrustClass;
  namespaceProtected: boolean;
  sourceSignatureVerified: boolean;
  sourceExpiresAt?: Date;
  contentDigest: string;
  seenContentDigests: readonly string[];
  attributionPreserved: boolean;
  now: Date;
}>;

const actionGoverningClasses = new Set<MemoryClass>(["policy", "constraint", "skill"]);
const directInstructionPattern = /\b(?:ignore (?:the )?(?:existing|previous)|from now on|route every|send every|execute|transfer all)\b/i;
const broadenedScopePattern = /\b(?:from now on|all users|all customers|every future|route every|send every)\b/i;
const secretPattern = /(?:authorization\s*:\s*bearer\s+\S+|\bsk-(?:live|prod|test)-[a-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b)/i;

export function screenCandidate(input: ScreeningInput): ScreeningFinding[] {
  const findings: ScreeningFinding[] = [];

  if (input.trustClass === "untrusted" && directInstructionPattern.test(input.canonicalText)) {
    findings.push({
      ruleId: "untrusted_tool_directive",
      severity: "critical",
      message: "An untrusted source is attempting to direct future agent actions.",
    });
  }

  if (broadenedScopePattern.test(input.canonicalText)) {
    findings.push({
      ruleId: "scope_broadening",
      severity: "high",
      message: "The candidate broadens an instruction beyond the observed interaction.",
    });
  }

  if (
    input.namespaceProtected &&
    actionGoverningClasses.has(input.memoryClass) &&
    (input.trustClass === "untrusted" || input.trustClass === "observed")
  ) {
    findings.push({
      ruleId: "protected_memory_mutation",
      severity: "critical",
      message: "The candidate attempts to modify protected action-governing memory.",
    });
  }

  if (secretPattern.test(input.canonicalText)) {
    findings.push({
      ruleId: "secret_material",
      severity: "critical",
      message: "Secret-like material cannot be committed to agent memory.",
      evidence: "[REDACTED]",
    });
  }

  if (
    (input.trustClass === "authenticated" || input.trustClass === "authoritative") &&
    !input.sourceSignatureVerified
  ) {
    findings.push({
      ruleId: "signature_unverified",
      severity: "high",
      message: "The claimed source trust level is not backed by a verified signature.",
    });
  }

  if (!input.attributionPreserved) {
    findings.push({
      ruleId: "attribution_removed",
      severity: "high",
      message: "The extracted claim lost its original attribution.",
    });
  }

  if (input.seenContentDigests.includes(input.contentDigest)) {
    findings.push({
      ruleId: "content_replay",
      severity: "high",
      message: "The same content digest has already been submitted.",
    });
  }

  if (input.sourceExpiresAt && input.sourceExpiresAt.getTime() <= input.now.getTime()) {
    findings.push({
      ruleId: "source_expired",
      severity: "high",
      message: "The source was no longer valid when the candidate was submitted.",
    });
  }

  return findings;
}
