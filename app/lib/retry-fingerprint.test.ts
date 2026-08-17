import { describe, expect, it } from "vitest";

import { retryFingerprint } from "./retry-fingerprint";

describe("retryFingerprint", () => {
  it("keeps delimiter-colliding request fields distinct", () => {
    expect(retryFingerprint(["review:a", "b:c"])).not.toBe(retryFingerprint(["review", "a:b:c"]));
  });

  it("canonicalizes equivalent structured requests independently of object insertion order", () => {
    expect(retryFingerprint({ reason: "same", request: { stableKey: "refund.review", reviewId: "review-1" } })).toBe(
      retryFingerprint({ request: { reviewId: "review-1", stableKey: "refund.review" }, reason: "same" }),
    );
  });
});
