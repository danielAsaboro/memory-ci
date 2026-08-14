import { randomUUID } from "node:crypto";

import { EventBridgeClient } from "@aws-sdk/client-eventbridge";

import { resolveDatabaseConnectionString } from "../aws/database-secret";
import { AwsSdkEventBridgeTransport, publishMemoryEvent } from "../aws/eventbridge";
import { createPool } from "../db/client";
import { claimPendingOutboxEvents, markOutboxFailure } from "../db/outbox";

let poolPromise: ReturnType<typeof createRuntimePool> | undefined;
async function createRuntimePool() { return createPool(await resolveDatabaseConnectionString()); }

export async function handler() {
  const pool = await (poolPromise ??= createRuntimePool());
  const client = await pool.connect();
  const transport = new AwsSdkEventBridgeTransport(new EventBridgeClient({ region: process.env.AWS_REGION }));
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) throw new Error("EVENT_BUS_NAME is required");
  let delivered = 0;
  let failed = 0;
  try {
    await client.query("BEGIN");
    const events = await claimPendingOutboxEvents(client, 100);
    for (const event of events) {
      try {
        const published = await publishMemoryEvent(transport, eventBusName, {
          id: event.id, tenantId: event.tenantId, type: event.eventType,
          aggregateId: event.aggregateId, occurredAt: new Date().toISOString(),
          traceId: randomUUID(), payload: event.payload,
        });
        await client.query(
          "UPDATE outbox_events SET delivered_at=now(),provider_event_id=$2,attempts=attempts+1 WHERE id=$1 AND delivered_at IS NULL",
          [event.id, published.eventId],
        );
        delivered += 1;
      } catch (error) {
        failed += 1;
        const code = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "publish_failed";
        await markOutboxFailure(client, event.id, code);
      }
    }
    await client.query("COMMIT");
    return { status: failed ? "partial" : "ok", delivered, failed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
