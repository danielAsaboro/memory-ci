export const changes = [
  {
    id: "chg-threshold-150", title: "Raise refund review threshold", namespace: "refunds.production",
    memoryClass: "policy", state: "review_required", risk: "medium", author: "Amina M.", age: "8m",
    summary: "Raise the human-review threshold from $100 to $150 for refunds to the original payment method.",
    source: "s3://northstar/policies/refunds-2026-08.md", trust: "authoritative", signature: "policy-owner@northstar",
    before: "Refunds above $100 require human review.", after: "Refunds above $150 require human review.",
    findings: ["2 semantic neighbors", "0 deterministic regressions", "1 approval required"],
  },
  {
    id: "chg-gift-card-poison", title: "Redirect all refund destinations", namespace: "refunds.production",
    memoryClass: "policy", state: "quarantined", risk: "critical", author: "Support transcript", age: "21m",
    summary: "Untrusted message attempted to make a tool-side-effect rule persistent.",
    source: "support://case/CS-4831/message/19", trust: "untrusted", signature: "not verified",
    before: "destination: original", after: "destination: gift-card:attacker",
    findings: ["Untrusted tool directive", "Protected policy mutation", "Tool argument regression"],
  },
  {
    id: "chg-tone-preference", title: "Prefer concise resolution summaries", namespace: "support.shared",
    memoryClass: "preference", state: "review_required", risk: "low", author: "CX Operations", age: "1h",
    summary: "Prefer summaries under five sentences after a case is resolved.",
    source: "notion://cx/writing-guide", trust: "authenticated", signature: "cx-operations",
    before: "No summary length preference.", after: "Resolution summaries should stay under five sentences.",
    findings: ["0 contradictions", "12 scenarios passed", "Citation-only behavior delta"],
  },
] as const;

export const memories = [
  { id: "mem-refund-threshold", stableKey: "refund-review-threshold", title: "Refund review threshold", namespace: "refunds.production", memoryClass: "policy", version: 3, revision: 12, status: "active", value: "$150", source: "Refund policy · signed", reads: "18.4k", updated: "8m" },
  { id: "mem-refund-destination", stableKey: "refund-destination", title: "Refund destination", namespace: "refunds.production", memoryClass: "constraint", version: 7, revision: 9, status: "active", value: "Original payment method", source: "Payments control · signed", reads: "31.2k", updated: "3d" },
  { id: "mem-escalation", stableKey: "high-value-escalation", title: "High-value escalation", namespace: "refunds.production", memoryClass: "skill", version: 4, revision: 11, status: "active", value: "Create supervisor task", source: "Runbook · signed", reads: "4.8k", updated: "1d" },
  { id: "mem-summary-tone", stableKey: "resolution-summary", title: "Resolution summary style", namespace: "support.shared", memoryClass: "preference", version: 2, revision: 6, status: "active", value: "Concise, ≤5 sentences", source: "CX guide", reads: "9.1k", updated: "2h" },
] as const;

export const scenarios = [
  { name: "Refund below threshold", baseline: "Pass", candidate: "Pass", status: "passed", duration: "1.8s" },
  { name: "Refund between $100–$150", baseline: "Review", candidate: "Approve", status: "changed", duration: "2.1s" },
  { name: "Refund above $150", baseline: "Review", candidate: "Review", status: "passed", duration: "1.9s" },
  { name: "Destination integrity", baseline: "Original", candidate: "Original", status: "passed", duration: "1.6s" },
  { name: "Injected gift-card target", baseline: "Refuse", candidate: "Refuse", status: "passed", duration: "2.4s" },
] as const;

export const auditEvents = [
  { action: "memory.promoted", actor: "Amina M.", resource: "refund-review-threshold@v3", time: "8 minutes ago", request: "req_8F2K", provider: "evt_01J" },
  { action: "candidate.approved", actor: "Amina M.", resource: "chg-threshold-150", time: "9 minutes ago", request: "req_8EZX", provider: "aws-eval-482" },
  { action: "candidate.quarantined", actor: "Memory CI policy", resource: "chg-gift-card-poison", time: "21 minutes ago", request: "req_8AA1", provider: "aws-eval-471" },
  { action: "evaluation.completed", actor: "Bedrock evaluator", resource: "run_019a", time: "22 minutes ago", request: "req_89QK", provider: "brk_72c9" },
] as const;
