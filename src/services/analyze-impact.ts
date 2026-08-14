import { randomUUID } from "node:crypto";

import type { TenantTransaction } from "../db/client";
import { DomainError } from "../domain/errors";
import type { RelationEvidence, RelationType } from "../domain/relations";

type CandidateProjection = Readonly<{
  id: string; namespaceId: string; memoryClass: string; contentDigest: string;
  canonicalPayload: Readonly<Record<string, unknown>>; canonicalText: string; embedding: string;
}>;

type MemoryProjection = Readonly<{
  id: string; contentDigest: string; canonicalPayload: Readonly<Record<string, unknown>>;
  canonicalText: string; distance: number;
}>;

export type ImpactMatch = Readonly<{
  memoryVersionId: string; distance: number; relationType: RelationType;
  confidence: number; evidence: Readonly<Record<string, unknown>>;
}>;

export type ImpactClassifier = (input: {
  candidate: CandidateProjection; memory: MemoryProjection; distance: number;
}) => Promise<RelationEvidence>;

const impactSql = `
  SELECT id,content_digest,canonical_payload,canonical_text,embedding <=> $4::VECTOR AS distance
  FROM memory_versions
  WHERE tenant_id=$1 AND namespace_id=$2 AND memory_class=$3 AND active
  ORDER BY embedding <=> $4::VECTOR
  LIMIT $5`;

export async function analyzeImpact(
  transaction: TenantTransaction,
  candidateId: string,
  dependencies: { classify: ImpactClassifier; limit?: number },
): Promise<{ candidateId: string; matches: ImpactMatch[] }> {
  const candidateResult = await transaction.client.query<{
    id: string; namespace_id: string; memory_class: string; content_digest: string;
    canonical_payload: Record<string, unknown>; canonical_text: string; embedding: string | null;
  }>(
    `SELECT id,namespace_id,memory_class,content_digest,canonical_payload,canonical_text,embedding
     FROM memory_candidates WHERE tenant_id=$1 AND id=$2`,
    [transaction.tenantId, candidateId],
  );
  const row = candidateResult.rows[0];
  if (!row) throw new DomainError("not_found", "Candidate was not found.");
  if (!row.embedding) throw new DomainError("invalid_input", "Candidate embedding is required for impact analysis.");
  const candidate: CandidateProjection = {
    id: row.id, namespaceId: row.namespace_id, memoryClass: row.memory_class,
    contentDigest: row.content_digest, canonicalPayload: row.canonical_payload,
    canonicalText: row.canonical_text, embedding: row.embedding,
  };

  const nearest = await transaction.client.query<{
    id: string; content_digest: string; canonical_payload: Record<string, unknown>;
    canonical_text: string; distance: string;
  }>(impactSql, [transaction.tenantId, candidate.namespaceId, candidate.memoryClass, candidate.embedding, dependencies.limit ?? 20]);
  const matches: ImpactMatch[] = [];
  for (const neighbor of nearest.rows) {
    const memory: MemoryProjection = {
      id: neighbor.id, contentDigest: neighbor.content_digest, canonicalPayload: neighbor.canonical_payload,
      canonicalText: neighbor.canonical_text, distance: Number(neighbor.distance),
    };
    const classified = await dependencies.classify({ candidate, memory, distance: memory.distance });
    if (classified.confidence < 0 || classified.confidence > 1) {
      throw new DomainError("invalid_input", "Relation confidence must be between zero and one.");
    }
    const evidence = { ...classified.evidence, vectorDistance: memory.distance };
    await transaction.client.query(
      `INSERT INTO memory_relations
       (tenant_id,id,from_candidate_id,to_memory_version_id,relation_type,confidence,evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,from_candidate_id,to_memory_version_id,relation_type)
       DO UPDATE SET confidence=excluded.confidence,evidence=excluded.evidence`,
      [transaction.tenantId, randomUUID(), candidateId, memory.id, classified.relationType,
        classified.confidence, evidence],
    );
    matches.push({
      memoryVersionId: memory.id, distance: memory.distance, relationType: classified.relationType,
      confidence: classified.confidence, evidence,
    });
  }
  return { candidateId, matches };
}

export async function explainImpactQuery(
  transaction: TenantTransaction,
  input: { namespaceId: string; memoryClass: string; embedding: string; limit: number },
): Promise<string[]> {
  const result = await transaction.client.query<Record<string, string>>(
    `EXPLAIN ${impactSql}`,
    [transaction.tenantId, input.namespaceId, input.memoryClass, input.embedding, input.limit],
  );
  return result.rows.map((row) => Object.values(row).join(" "));
}
