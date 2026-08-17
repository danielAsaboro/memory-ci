import type { TenantTransaction } from "../db/client";
import { MemoryRepository } from "../db/memories";
import type { MemoryVersion, TenantContext } from "../domain/types";

export async function rollbackMemory(
  transaction: TenantTransaction,
  context: TenantContext,
  input: { lineageId: string; targetVersionId: string; reason: string; idempotencyKey: string },
): Promise<MemoryVersion> {
  return new MemoryRepository(transaction).rollback({ ...input, actorId: context.principalId, requestId: context.requestId });
}
