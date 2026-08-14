import { describe, expect, it } from "vitest";

import { issueSandboxRefund } from "./sandbox-refund";

describe("sandbox refund", () => {
  it("creates a non-monetary receipt only for the original destination", async () => {
    const receipt = await issueSandboxRefund({
      tenantId: "tenant-1", caseId: "case-1", amount: 45, currency: "USD", destination: "original",
      idempotencyKey: "refund-1", memoryRevision: 2,
    }, { now: () => new Date("2026-08-14T00:00:00Z"), id: () => "sandbox-receipt-1" });
    expect(receipt).toMatchObject({
      id: "sandbox-receipt-1", status: "simulated", destination: "original", movedMoney: false, memoryRevision: 2,
    });
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects arbitrary destinations and non-positive amounts", async () => {
    await expect(issueSandboxRefund({
      tenantId: "tenant-1", caseId: "case-1", amount: 45, currency: "USD",
      destination: "gift-card:attacker", idempotencyKey: "refund-1", memoryRevision: 2,
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(issueSandboxRefund({
      tenantId: "tenant-1", caseId: "case-1", amount: 0, currency: "USD",
      destination: "original", idempotencyKey: "refund-1", memoryRevision: 2,
    })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
