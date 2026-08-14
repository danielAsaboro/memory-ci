import { createHash, randomUUID } from "node:crypto";

import type { TenantTransaction } from "./client";

export type AuditEvent = Readonly<{
  id: string; actorId: string; action: string; resourceType: string; resourceId: string;
  requestId: string; safeDetails: Readonly<Record<string, unknown>>; eventDigest: string; createdAt: Date;
}>;

type AuditRow = {
  id: string; actor_id: string; action: string; resource_type: string; resource_id: string;
  request_id: string; safe_details: Record<string, unknown>; event_digest: string; created_at: Date;
};

const mapAudit = (row: AuditRow): AuditEvent => ({
  id: row.id, actorId: row.actor_id, action: row.action, resourceType: row.resource_type,
  resourceId: row.resource_id, requestId: row.request_id, safeDetails: row.safe_details,
  eventDigest: row.event_digest, createdAt: row.created_at,
});

export class AuditRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async append(input: {
    actorId: string; action: string; resourceType: string; resourceId: string;
    requestId?: string; traceId?: string; providerRequestId?: string;
    safeDetails?: Readonly<Record<string, unknown>>;
  }): Promise<AuditEvent> {
    // Serialize each tenant's digest chain so concurrent writes cannot fork it.
    await this.transaction.client.query(
      "SELECT id FROM tenants WHERE id=$1 FOR UPDATE",
      [this.transaction.tenantId],
    );
    const previous = await this.transaction.client.query<{ event_digest: string }>(
      `SELECT event_digest FROM audit_events WHERE tenant_id=$1
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [this.transaction.tenantId],
    );
    const previousDigest = previous.rows[0]?.event_digest ?? null;
    const id = randomUUID();
    const requestId = input.requestId ?? randomUUID();
    const safeDetails = input.safeDetails ?? {};
    const eventDigest = createHash("sha256").update(JSON.stringify({
      tenantId: this.transaction.tenantId, id, actorId: input.actorId, action: input.action,
      resourceType: input.resourceType, resourceId: input.resourceId, requestId,
      safeDetails, previousDigest,
    })).digest("hex");
    const result = await this.transaction.client.query<AuditRow>(
      `INSERT INTO audit_events
       (tenant_id,id,actor_id,action,resource_type,resource_id,request_id,trace_id,
        provider_request_id,safe_details,previous_event_digest,event_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [this.transaction.tenantId, id, input.actorId, input.action, input.resourceType,
        input.resourceId, requestId, input.traceId ?? null, input.providerRequestId ?? null,
        safeDetails, previousDigest, eventDigest],
    );
    return mapAudit(result.rows[0]!);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const result = await this.transaction.client.query<AuditRow>(
      `SELECT * FROM audit_events WHERE tenant_id=$1 ORDER BY created_at, id LIMIT $2`,
      [this.transaction.tenantId, limit],
    );
    return result.rows.map(mapAudit);
  }
}
