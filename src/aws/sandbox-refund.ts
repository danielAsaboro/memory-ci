import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { DomainError } from "../domain/errors";
import { canonicalJson } from "../services/provenance";

const inputSchema = z.object({
  tenantId: z.string().min(1), caseId: z.string().min(1), amount: z.number().positive().max(10_000),
  currency: z.string().length(3), destination: z.string(), idempotencyKey: z.string().min(1),
  memoryRevision: z.number().int().positive(),
}).strict();

export async function issueSandboxRefund(rawInput: z.input<typeof inputSchema>, dependencies: {
  now?: () => Date; id?: () => string;
} = {}) {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) throw new DomainError("invalid_input", "Sandbox refund input is invalid.");
  if (parsed.data.destination !== "original") {
    throw new DomainError("forbidden", "Sandbox refunds can only target the original payment method.");
  }
  const receipt = {
    id: dependencies.id?.() ?? randomUUID(), tenantId: parsed.data.tenantId, caseId: parsed.data.caseId,
    amount: parsed.data.amount, currency: parsed.data.currency, destination: "original" as const,
    status: "simulated" as const, movedMoney: false as const, idempotencyKey: parsed.data.idempotencyKey,
    memoryRevision: parsed.data.memoryRevision, createdAt: (dependencies.now?.() ?? new Date()).toISOString(),
  };
  return { ...receipt, digest: createHash("sha256").update(canonicalJson(receipt)).digest("hex") };
}
