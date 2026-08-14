import { describe, expect, it } from "vitest";

import { consumeEventOnce, publishMemoryEvent, type EventBridgeTransport } from "./eventbridge";

describe("EventBridge evidence", () => {
  it("publishes a complete tenant-safe envelope and preserves the provider event ID", async () => {
    let request: Record<string, unknown> = {};
    const transport: EventBridgeTransport = {
      async putEvents(input) { request = input as unknown as Record<string, unknown>; return {
        FailedEntryCount: 0, Entries: [{ EventId: "eventbridge-1" }], $metadata: { requestId: "events-request-1" },
      }; },
    };
    const receipt = await publishMemoryEvent(transport, "memory-ci", {
      id: "event-1", tenantId: "tenant-1", type: "memory.activated", aggregateId: "memory-1",
      occurredAt: "2026-08-14T00:00:00.000Z", traceId: "trace-1", payload: { revision: 2 },
    });
    expect(receipt).toEqual({ eventId: "eventbridge-1", providerRequestId: "events-request-1" });
    expect(request).toMatchObject({ Entries: [expect.objectContaining({ EventBusName: "memory-ci", Source: "memory-ci" })] });
    const entries = request.Entries as Array<{ Detail: string }>;
    expect(JSON.parse(entries[0]!.Detail)).toMatchObject({
      schemaVersion: "1", eventId: "event-1", tenantId: "tenant-1", aggregateId: "memory-1",
      traceId: "trace-1", payload: { revision: 2 },
    });
  });

  it("processes duplicate deliveries exactly once", async () => {
    const seen = new Set<string>();
    let executions = 0;
    const store = {
      async claim(id: string) { if (seen.has(id)) return false; seen.add(id); return true; },
      async complete() {},
    };
    const event = { id: "event-1", detail: { tenantId: "tenant-1" } };
    const first = await consumeEventOnce(store, event, async () => { executions += 1; return { ok: true }; });
    const duplicate = await consumeEventOnce(store, event, async () => { executions += 1; return { ok: true }; });
    expect(first).toEqual({ status: "processed", value: { ok: true } });
    expect(duplicate).toEqual({ status: "duplicate" });
    expect(executions).toBe(1);
  });
});
