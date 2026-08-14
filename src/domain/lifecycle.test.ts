import { describe, expect, it } from "vitest";

import { DomainError } from "./errors";
import { transitionCandidate } from "./lifecycle";

describe("transitionCandidate", () => {
  it("advances a candidate through the governed review path", () => {
    expect(transitionCandidate("proposed", "begin_screening")).toBe("screening");
    expect(transitionCandidate("screening", "screening_passed")).toBe("evaluating");
    expect(transitionCandidate("evaluating", "evaluation_passed")).toBe("review_required");
    expect(transitionCandidate("review_required", "approve")).toBe("approved");
    expect(transitionCandidate("approved", "activate")).toBe("active");
    expect(transitionCandidate("active", "supersede")).toBe("superseded");
  });

  it("quarantines a candidate from screening or evaluation", () => {
    expect(transitionCandidate("screening", "quarantine")).toBe("quarantined");
    expect(transitionCandidate("evaluating", "quarantine")).toBe("quarantined");
  });

  it("records provider failure without treating it as a passing evaluation", () => {
    expect(transitionCandidate("screening", "provider_failed")).toBe("failed");
    expect(transitionCandidate("evaluating", "provider_failed")).toBe("failed");
  });

  it("rejects an attempt to approve a quarantined candidate", () => {
    expect(() => transitionCandidate("quarantined", "approve")).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "invalid_transition",
      }),
    );
  });

  it("requires activation before a candidate can be superseded", () => {
    expect(() => transitionCandidate("approved", "supersede")).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "invalid_transition",
      }),
    );
  });

  it("allows rollback only from an active memory version", () => {
    expect(transitionCandidate("active", "roll_back")).toBe("rolled_back");
    expect(() => transitionCandidate("superseded", "roll_back")).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "invalid_transition",
      }),
    );
  });

  it.each(["quarantined", "rejected", "superseded", "rolled_back", "expired", "failed"] as const)(
    "keeps terminal state %s immutable",
    (state) => {
      expect(() => transitionCandidate(state, "begin_screening")).toThrowError(
        expect.objectContaining<Partial<DomainError>>({
          code: "invalid_transition",
        }),
      );
    },
  );
});
