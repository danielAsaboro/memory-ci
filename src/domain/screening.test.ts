import { describe, expect, it } from "vitest";

import { adversarialCorpus } from "../fixtures/adversarial-corpus";
import { screenCandidate } from "./screening";

describe("screenCandidate", () => {
  it.each(adversarialCorpus)("classifies $name", (fixture) => {
    const findings = screenCandidate(fixture.input);
    expect(findings.map((finding) => finding.ruleId).sort()).toEqual([...fixture.expectedRuleIds].sort());
  });

  it("rejects a repeated content digest as a replay", () => {
    const findings = screenCandidate({
      canonicalText: "Refunds under USD 100 return to the original payment method.",
      memoryClass: "policy",
      trustClass: "authoritative",
      namespaceProtected: true,
      sourceSignatureVerified: true,
      contentDigest: "digest-1",
      seenContentDigests: ["digest-1"],
      attributionPreserved: true,
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "content_replay",
        severity: "high",
      }),
    );
  });

  it("flags an expired authoritative source", () => {
    const findings = screenCandidate({
      canonicalText: "The manual-review threshold is USD 150.",
      memoryClass: "policy",
      trustClass: "authoritative",
      namespaceProtected: true,
      sourceSignatureVerified: true,
      sourceExpiresAt: new Date("2026-08-13T12:00:00Z"),
      contentDigest: "digest-2",
      seenContentDigests: [],
      attributionPreserved: true,
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(findings).toContainEqual(
      expect.objectContaining({
        ruleId: "source_expired",
        severity: "high",
      }),
    );
  });

  it("treats secret material as a critical finding and redacts its evidence", () => {
    const findings = screenCandidate({
      canonicalText: "Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz123456",
      memoryClass: "fact",
      trustClass: "observed",
      namespaceProtected: false,
      sourceSignatureVerified: false,
      contentDigest: "secret-critical",
      seenContentDigests: [],
      attributionPreserved: true,
      now: new Date("2026-08-14T12:00:00Z"),
    });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "secret_material",
        severity: "critical",
        evidence: "[REDACTED]",
      }),
    ]);
  });
});
