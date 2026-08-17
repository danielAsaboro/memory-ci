import { randomUUID } from "node:crypto";

import { DomainError } from "../domain/errors";
import type { MemoryVersion } from "../domain/types";
import { AuditRepository } from "./audit";
import type { TenantTransaction } from "./client";
import { OutboxRepository } from "./outbox";
import { ReviewRepository } from "./reviews";

type MemoryRow = {
  id: string; tenant_id: string; namespace_id: string; lineage_id: string; candidate_id: string;
  version: string; revision: string; active: boolean; canonical_payload: Record<string, unknown>;
  content_digest: string; valid_from: Date; valid_until: Date | null;
};

const mapMemory = (row: MemoryRow): MemoryVersion => ({
  id: row.id, tenantId: row.tenant_id, namespaceId: row.namespace_id, lineageId: row.lineage_id,
  candidateId: row.candidate_id, version: Number(row.version), revision: Number(row.revision),
  active: row.active, canonicalPayload: row.canonical_payload, contentDigest: row.content_digest,
  validFrom: row.valid_from, validUntil: row.valid_until,
});

export class MemoryRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  private async findIdempotent(key: string, operation: string): Promise<MemoryVersion | null> {
    const result = await this.transaction.client.query<{ resource_id: string | null }>(
      `SELECT resource_id FROM idempotency_keys WHERE tenant_id=$1 AND idempotency_key=$2 AND operation=$3`,
      [this.transaction.tenantId, key, operation],
    );
    if (!result.rows[0]?.resource_id) return null;
    const memory = await this.transaction.client.query<MemoryRow>(
      "SELECT * FROM memory_versions WHERE tenant_id=$1 AND id=$2",
      [this.transaction.tenantId, result.rows[0].resource_id],
    );
    return memory.rows[0] ? mapMemory(memory.rows[0]) : null;
  }

  private async saveIdempotency(key: string, operation: string, version: MemoryVersion): Promise<void> {
    await this.transaction.client.query(
      `INSERT INTO idempotency_keys
       (tenant_id,idempotency_key,operation,request_digest,response_status,response_body,resource_id,expires_at)
       VALUES ($1,$2,$3,$4,200,$5,$6,now() + INTERVAL '24 hours')`,
      [this.transaction.tenantId, key, operation, `${operation}:${version.candidateId}`, { memoryVersionId: version.id }, version.id],
    );
  }

  async getActiveAtRevision(namespaceId: string, revision: number): Promise<MemoryVersion[]> {
    const result = await this.transaction.client.query<MemoryRow>(
      `SELECT id,tenant_id,namespace_id,lineage_id,candidate_id,version,revision,active,
              canonical_payload,content_digest,valid_from,valid_until
       FROM (
         SELECT v.*, row_number() OVER (PARTITION BY lineage_id ORDER BY revision DESC, version DESC) AS rank
         FROM memory_versions v
         WHERE tenant_id=$1 AND namespace_id=$2 AND revision <= $3
       ) ranked WHERE rank=1 ORDER BY lineage_id`,
      [this.transaction.tenantId, namespaceId, revision],
    );
    return result.rows.map(mapMemory);
  }

  async findSimilar(input: {
    namespaceId: string;
    memoryClass: string;
    embedding: string;
    limit?: number;
  }): Promise<Array<{ memory: MemoryVersion; distance: number }>> {
    const result = await this.transaction.client.query<MemoryRow & { distance: string }>(
      `SELECT id,tenant_id,namespace_id,lineage_id,candidate_id,version,revision,active,
              canonical_payload,content_digest,valid_from,valid_until,
              embedding <=> $4::VECTOR AS distance
       FROM memory_versions
       WHERE tenant_id=$1 AND namespace_id=$2 AND memory_class=$3 AND active
       ORDER BY embedding <=> $4::VECTOR
       LIMIT $5`,
      [this.transaction.tenantId, input.namespaceId, input.memoryClass, input.embedding, input.limit ?? 10],
    );
    return result.rows.map((row) => ({ memory: mapMemory(row), distance: Number(row.distance) }));
  }

  async searchActiveSemantic(namespaceId: string, embedding: string, limit = 10): Promise<MemoryVersion[]> {
    const result = await this.transaction.client.query<MemoryRow>(
      `SELECT id,tenant_id,namespace_id,lineage_id,candidate_id,version,revision,active,canonical_payload,content_digest,valid_from,valid_until
       FROM memory_versions WHERE tenant_id=$1 AND namespace_id=$2 AND active AND embedding <=> $3::VECTOR <= 0.8
       ORDER BY embedding <=> $3::VECTOR LIMIT $4`,
      [this.transaction.tenantId, namespaceId, embedding, limit],
    );
    return result.rows.map(mapMemory);
  }

  async promote(input: {
    candidateId: string; reviewId: string; actorId: string; stableKey: string;
    reason: string; idempotencyKey: string; requestId?: string;
  }): Promise<MemoryVersion> {
    const prior = await this.findIdempotent(input.idempotencyKey, "memory.promote");
    if (prior) return prior;

    const candidateResult = await this.transaction.client.query<{
      id: string; namespace_id: string; state: string; memory_class: string; canonical_payload: Record<string, unknown>;
      canonical_text: string; content_digest: string; embedding: string | null;
    }>("SELECT * FROM memory_candidates WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [this.transaction.tenantId, input.candidateId]);
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
    if (candidate.state !== "approved") throw new DomainError("conflict", "Only approved candidates can be promoted.");
    if (!candidate.embedding) throw new DomainError("invalid_input", "Candidate embedding is required for promotion.");

    const review = await new ReviewRepository(this.transaction).assertFresh(input.candidateId, input.reviewId);
    const namespaceResult = await this.transaction.client.query<{ current_revision: string }>(
      "SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [this.transaction.tenantId, candidate.namespace_id],
    );
    const currentRevision = Number(namespaceResult.rows[0]?.current_revision);
    if (currentRevision !== review.baselineRevision) throw new DomainError("stale_review", "Review baseline is stale.");

    const lineageId = randomUUID();
    await this.transaction.client.query(
      `INSERT INTO memory_lineages (tenant_id,id,namespace_id,stable_key) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id,namespace_id,stable_key) DO NOTHING`,
      [this.transaction.tenantId, lineageId, candidate.namespace_id, input.stableKey],
    );
    const lineage = await this.transaction.client.query<{ id: string }>(
      "SELECT id FROM memory_lineages WHERE tenant_id=$1 AND namespace_id=$2 AND stable_key=$3 FOR UPDATE",
      [this.transaction.tenantId, candidate.namespace_id, input.stableKey],
    );
    const resolvedLineageId = lineage.rows[0]!.id;
    const nextRevision = currentRevision + 1;
    const maxVersion = await this.transaction.client.query<{ version: string }>(
      "SELECT coalesce(max(version),0) AS version FROM memory_versions WHERE tenant_id=$1 AND lineage_id=$2",
      [this.transaction.tenantId, resolvedLineageId],
    );
    const nextVersion = Number(maxVersion.rows[0]!.version) + 1;
    const active = await this.transaction.client.query<MemoryRow>(
      `UPDATE memory_versions SET active=false, valid_until=now()
       WHERE tenant_id=$1 AND lineage_id=$2 AND active RETURNING *`,
      [this.transaction.tenantId, resolvedLineageId],
    );
    if (active.rows[0]) {
      await this.transaction.client.query(
        "UPDATE memory_candidates SET state='superseded',updated_at=now() WHERE tenant_id=$1 AND id=$2 AND state='active'",
        [this.transaction.tenantId, active.rows[0].candidate_id],
      );
      await this.recordActivation(active.rows[0], "superseded", nextRevision, input.actorId, input.reason);
      await new AuditRepository(this.transaction).append({
        actorId: input.actorId, action: "memory.superseded", resourceType: "memory_version",
        resourceId: active.rows[0].id, safeDetails: { revision: nextRevision },
      });
    }

    const inserted = await this.transaction.client.query<MemoryRow>(
      `INSERT INTO memory_versions
       (tenant_id,id,namespace_id,lineage_id,candidate_id,version,revision,active,memory_class,
        canonical_payload,canonical_text,content_digest,embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12::VECTOR) RETURNING *`,
      [this.transaction.tenantId, randomUUID(), candidate.namespace_id, resolvedLineageId,
        candidate.id, nextVersion, nextRevision, candidate.memory_class, candidate.canonical_payload,
        candidate.canonical_text, candidate.content_digest, candidate.embedding],
    );
    const version = mapMemory(inserted.rows[0]!);
    await this.transaction.client.query(
      "UPDATE memory_candidates SET state='active',lineage_id=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [this.transaction.tenantId, candidate.id, resolvedLineageId],
    );
    await this.transaction.client.query(
      "UPDATE agent_namespaces SET current_revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [this.transaction.tenantId, candidate.namespace_id, nextRevision],
    );
    await this.recordActivation(inserted.rows[0]!, "promoted", nextRevision, input.actorId, input.reason);
    await new AuditRepository(this.transaction).append({
      actorId: input.actorId, action: "memory.promoted", resourceType: "memory_version", resourceId: version.id,
      requestId: input.requestId,
      safeDetails: { revision: nextRevision, candidateId: candidate.id },
    });
    await new OutboxRepository(this.transaction).enqueue({
      eventType: "memory.promoted", aggregateType: "memory_version", aggregateId: version.id,
      payload: { tenantId: this.transaction.tenantId, namespaceId: candidate.namespace_id, revision: nextRevision },
    });
    await this.saveIdempotency(input.idempotencyKey, "memory.promote", version);
    return version;
  }

  async rollback(input: {
    lineageId: string; targetVersionId: string; actorId: string; reason: string; idempotencyKey: string; requestId?: string;
  }): Promise<MemoryVersion> {
    const prior = await this.findIdempotent(input.idempotencyKey, "memory.rollback");
    if (prior) return prior;
    const targetResult = await this.transaction.client.query<MemoryRow & {
      memory_class: string; canonical_text: string; embedding: string;
    }>("SELECT * FROM memory_versions WHERE tenant_id=$1 AND lineage_id=$2 AND id=$3", [this.transaction.tenantId, input.lineageId, input.targetVersionId]);
    const target = targetResult.rows[0];
    if (!target) throw new DomainError("not_found", "Rollback target was not found.");
    const namespace = await this.transaction.client.query<{ current_revision: string }>(
      "SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [this.transaction.tenantId, target.namespace_id],
    );
    const nextRevision = Number(namespace.rows[0]!.current_revision) + 1;
    const maxVersion = await this.transaction.client.query<{ version: string }>(
      "SELECT max(version) AS version FROM memory_versions WHERE tenant_id=$1 AND lineage_id=$2",
      [this.transaction.tenantId, input.lineageId],
    );
    await this.transaction.client.query(
      "UPDATE memory_versions SET active=false,valid_until=now() WHERE tenant_id=$1 AND lineage_id=$2 AND active",
      [this.transaction.tenantId, input.lineageId],
    );
    const inserted = await this.transaction.client.query<MemoryRow>(
      `INSERT INTO memory_versions
       (tenant_id,id,namespace_id,lineage_id,candidate_id,version,revision,active,memory_class,
        canonical_payload,canonical_text,content_digest,embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12::VECTOR) RETURNING *`,
      [this.transaction.tenantId, randomUUID(), target.namespace_id, target.lineage_id, target.candidate_id,
        Number(maxVersion.rows[0]!.version) + 1, nextRevision, target.memory_class, target.canonical_payload,
        target.canonical_text, target.content_digest, target.embedding],
    );
    const version = mapMemory(inserted.rows[0]!);
    await this.transaction.client.query(
      "UPDATE agent_namespaces SET current_revision=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
      [this.transaction.tenantId, target.namespace_id, nextRevision],
    );
    await this.recordActivation(inserted.rows[0]!, "rolled_back", nextRevision, input.actorId, input.reason);
    await new AuditRepository(this.transaction).append({
      actorId: input.actorId, action: "memory.rolled_back", resourceType: "memory_version", resourceId: version.id,
      requestId: input.requestId,
      safeDetails: { revision: nextRevision, targetVersionId: input.targetVersionId },
    });
    await new OutboxRepository(this.transaction).enqueue({
      eventType: "memory.rolled_back", aggregateType: "memory_version", aggregateId: version.id,
      payload: { tenantId: this.transaction.tenantId, namespaceId: target.namespace_id, revision: nextRevision },
    });
    await this.saveIdempotency(input.idempotencyKey, "memory.rollback", version);
    return version;
  }

  private async recordActivation(row: MemoryRow, eventType: "promoted" | "superseded" | "rolled_back", revision: number, actorId: string, reason: string): Promise<void> {
    await this.transaction.client.query(
      `INSERT INTO activation_events
       (tenant_id,id,namespace_id,lineage_id,memory_version_id,event_type,revision,actor_id,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [this.transaction.tenantId, randomUUID(), row.namespace_id, row.lineage_id, row.id,
        eventType, revision, actorId, reason],
    );
  }
}
