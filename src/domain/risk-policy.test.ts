import { describe, expect, it } from "vitest";

import { evaluateRisk } from "./risk-policy";

describe("evaluateRisk", () => {
  it("quarantines candidates containing secret material", () => {
    expect(
      evaluateRisk({
        memoryClass: "fact",
        trustClass: "observed",
        findings: [{ ruleId: "secret_material", severity: "critical", message: "Secret-like content." }],
        behavioralChange: false,
      }),
    ).toEqual({
      risk: "critical",
      requiredApprovals: 0,
      autoDisposition: "quarantine",
      reasons: ["secret_material"],
    });
  });

  it("quarantines an untrusted change to action-governing memory", () => {
    const result = evaluateRisk({
      memoryClass: "policy",
      trustClass: "untrusted",
      findings: [{ ruleId: "protected_memory_mutation", severity: "critical", message: "Protected policy." }],
      behavioralChange: true,
    });

    expect(result.autoDisposition).toBe("quarantine");
    expect(result.risk).toBe("critical");
  });

  it("requires two approvals for a behavior-changing authenticated policy", () => {
    expect(
      evaluateRisk({
        memoryClass: "policy",
        trustClass: "authenticated",
        findings: [],
        behavioralChange: true,
      }),
    ).toEqual({
      risk: "high",
      requiredApprovals: 2,
      autoDisposition: "none",
      reasons: ["behavioral_change", "action_governing_memory"],
    });
  });

  it("never lets a low-risk signal reduce an existing high-risk finding", () => {
    const result = evaluateRisk({
      memoryClass: "episode",
      trustClass: "authoritative",
      findings: [{ ruleId: "content_replay", severity: "high", message: "Replay." }],
      behavioralChange: false,
    });

    expect(result.risk).toBe("high");
    expect(result.requiredApprovals).toBe(1);
  });

  it("allows a non-behavioral authenticated episode to proceed without approval", () => {
    expect(
      evaluateRisk({
        memoryClass: "episode",
        trustClass: "authenticated",
        findings: [],
        behavioralChange: false,
      }),
    ).toEqual({
      risk: "low",
      requiredApprovals: 0,
      autoDisposition: "none",
      reasons: [],
    });
  });
});
