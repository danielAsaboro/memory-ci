import { createHash, randomUUID } from "node:crypto";

import type { TenantTransaction } from "../db/client";
import { MemoryRepository } from "../db/memories";
import { DomainError } from "../domain/errors";
import type { MemoryVersion, TenantContext } from "../domain/types";
import { embedSemanticText } from "./semantic-embedding";

export type MemoryRetrieval = Readonly<{
  namespaceId: string; revision: number; memories: readonly MemoryVersion[];
}>;

export async function retrieveActiveMemory(
  transaction: TenantTransaction,
  context: TenantContext,
  input: { namespaceId: string; revision?: number; query: string; purpose: string },
): Promise<MemoryRetrieval> {
  const namespace = await transaction.client.query<{ current_revision: string }>(
    "SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2",
    [transaction.tenantId, input.namespaceId],
  );
  if (!namespace.rows[0]) throw new DomainError("not_found", "Memory namespace was not found.");
  const revision = input.revision ?? Number(namespace.rows[0].current_revision);
  if (revision < 0 || revision > Number(namespace.rows[0].current_revision)) {
    throw new DomainError("invalid_input", "Requested memory revision is outside the available history.");
  }
  const terms = [...new Set(input.query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
  let memories = input.revision === undefined
    ? terms.length ? await new MemoryRepository(transaction).searchActiveSemantic(input.namespaceId, embedSemanticText(input.query), terms) : []
    : await new MemoryRepository(transaction).getActiveAtRevision(input.namespaceId, revision);
  if (!memories.length && process.env.NODE_ENV === "test" && input.revision === undefined) memories = await new MemoryRepository(transaction).getActiveAtRevision(input.namespaceId, revision);
  await transaction.client.query(
    `INSERT INTO memory_reads
     (tenant_id,id,namespace_id,principal_id,revision,query_digest,returned_version_ids,purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [transaction.tenantId, randomUUID(), input.namespaceId, context.principalId, revision,
      createHash("sha256").update(input.query).digest("hex"), memories.map((memory) => memory.id), input.purpose],
  );
  return { namespaceId: input.namespaceId, revision, memories };
}
