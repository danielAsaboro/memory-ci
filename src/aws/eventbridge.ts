import {
  EventBridgeClient,
  PutEventsCommand,
  type PutEventsCommandInput,
  type PutEventsCommandOutput,
} from "@aws-sdk/client-eventbridge";

import { DomainError } from "../domain/errors";

export interface EventBridgeTransport { putEvents(input: PutEventsCommandInput): Promise<PutEventsCommandOutput> }
export class AwsSdkEventBridgeTransport implements EventBridgeTransport {
  constructor(private readonly client: EventBridgeClient) {}
  putEvents(input: PutEventsCommandInput): Promise<PutEventsCommandOutput> {
    return this.client.send(new PutEventsCommand(input));
  }
}

export type MemoryEvent = Readonly<{
  id: string; tenantId: string; type: string; aggregateId: string; occurredAt: string;
  traceId: string; payload: Readonly<Record<string, unknown>>;
}>;

export async function publishMemoryEvent(
  transport: EventBridgeTransport,
  eventBusName: string,
  event: MemoryEvent,
): Promise<{ eventId: string; providerRequestId: string | null }> {
  const response = await transport.putEvents({ Entries: [{
    EventBusName: eventBusName, Source: "memory-ci", DetailType: event.type,
    Time: new Date(event.occurredAt),
    Detail: JSON.stringify({
      schemaVersion: "1", eventId: event.id, tenantId: event.tenantId, aggregateId: event.aggregateId,
      occurredAt: event.occurredAt, traceId: event.traceId, payload: event.payload,
    }),
  }] });
  const entry = response.Entries?.[0];
  if (response.FailedEntryCount || !entry?.EventId) {
    throw new DomainError("provider_unavailable", "EventBridge did not accept the memory event.", {
      errorCode: entry?.ErrorCode ?? "unknown",
    });
  }
  return { eventId: entry.EventId, providerRequestId: response.$metadata.requestId ?? null };
}

export async function consumeEventOnce<T>(
  store: { claim(id: string): Promise<boolean>; complete(id: string): Promise<void> },
  event: { id: string; detail: unknown },
  execute: () => Promise<T>,
): Promise<{ status: "processed"; value: T } | { status: "duplicate" }> {
  if (!(await store.claim(event.id))) return { status: "duplicate" };
  const value = await execute();
  await store.complete(event.id);
  return { status: "processed", value };
}
