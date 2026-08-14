import { randomUUID } from "node:crypto";

import type { TenantTransaction } from "./client";

export type OutboxEvent = Readonly<{
  id: string; eventType: string; aggregateType: string; aggregateId: string;
  payload: Readonly<Record<string, unknown>>; attempts: number; deliveredAt: Date | null;
}>;

type OutboxRow = {
  id: string; event_type: string; aggregate_type: string; aggregate_id: string;
  payload: Record<string, unknown>; attempts: string; delivered_at: Date | null;
};

const mapOutbox = (row: OutboxRow): OutboxEvent => ({
  id: row.id, eventType: row.event_type, aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id, payload: row.payload, attempts: Number(row.attempts),
  deliveredAt: row.delivered_at,
});

export class OutboxRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async enqueue(input: { eventType: string; aggregateType: string; aggregateId: string; payload: Readonly<Record<string, unknown>> }): Promise<OutboxEvent> {
    const result = await this.transaction.client.query<OutboxRow>(
      `INSERT INTO outbox_events (tenant_id,id,event_type,aggregate_type,aggregate_id,payload)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [this.transaction.tenantId, randomUUID(), input.eventType, input.aggregateType, input.aggregateId, input.payload],
    );
    return mapOutbox(result.rows[0]!);
  }

  async listPending(limit = 100): Promise<OutboxEvent[]> {
    const result = await this.transaction.client.query<OutboxRow>(
      `SELECT * FROM outbox_events WHERE tenant_id=$1 AND delivered_at IS NULL AND available_at <= now()
       ORDER BY available_at, id LIMIT $2`,
      [this.transaction.tenantId, limit],
    );
    return result.rows.map(mapOutbox);
  }

  async markDelivered(id: string, providerEventId: string): Promise<void> {
    await this.transaction.client.query(
      `UPDATE outbox_events SET delivered_at=now(), provider_event_id=$3, attempts=attempts+1
       WHERE tenant_id=$1 AND id=$2 AND delivered_at IS NULL`,
      [this.transaction.tenantId, id, providerEventId],
    );
  }
}

export async function claimPendingOutboxEvents(client: TenantTransaction["client"], limit = 100): Promise<Array<OutboxEvent & { tenantId: string }>> {
  const result = await client.query<OutboxRow & { tenant_id: string }>(
    `SELECT * FROM outbox_events WHERE delivered_at IS NULL AND available_at <= now()
     ORDER BY available_at, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return result.rows.map((row) => ({ ...mapOutbox(row), tenantId: row.tenant_id }));
}

export async function markOutboxFailure(client: TenantTransaction["client"], id: string, errorCode: string): Promise<void> {
  await client.query(
    `UPDATE outbox_events SET attempts=attempts+1,last_error_code=$2,
       available_at=now() + (least(attempts + 1, 10)::STRING || ' seconds')::INTERVAL
     WHERE id=$1 AND delivered_at IS NULL`,
    [id, errorCode.slice(0, 255)],
  );
}
