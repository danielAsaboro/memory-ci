import type { TenantTransaction } from "../db/client";
import { MemoryRepository } from "../db/memories";
import type { MemoryVersion, TenantContext } from "../domain/types";

export async function promoteCandidate(
  transaction: TenantTransaction,
  context: TenantContext,
  input: {
    candidateId: string; reviewId: string; stableKey: string; reason: string; idempotencyKey: string;
  },
): Promise<MemoryVersion> {
  return new MemoryRepository(transaction).promote({
    ...input,
    actorId: context.principalId,
    requestId: context.requestId,
  });
}
