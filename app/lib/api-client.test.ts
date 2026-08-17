import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";

import { StashApiError, stashMutation, stashQuery } from "./api-client";

describe("Stash API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the same-origin gateway and validates successful query data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "Northstar" }), {
      headers: { "content-type": "application/json", "x-request-id": "request-1" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stashQuery("/v1/workspace/status", z.object({ name: z.string() }))).resolves.toEqual({ name: "Northstar" });
    expect(fetchMock).toHaveBeenCalledWith("/api/stash/v1/workspace/status", { cache: "no-store", method: "GET" });
  });

  it("sends JSON mutations with a caller-provided idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stashMutation("/v1/candidates/candidate-1/screen", {}, z.object({ accepted: z.boolean() }), "write-123"))
      .resolves.toEqual({ accepted: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/stash/v1/candidates/candidate-1/screen", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json", "idempotency-key": "write-123" },
      body: "{}",
    });
  });

  it("generates an idempotency key when a mutation caller does not provide one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await stashMutation("/v1/candidates/candidate-1/screen", {}, z.object({ accepted: z.boolean() }));

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "idempotency-key": expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    });
  });

  it.each([
    ["fetch", () => Promise.reject(new Error("network secret"))],
    ["body", () => Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: () => Promise.reject(new Error("body secret")) } as Response)],
  ])("wraps %s transport failures in a safe StashApiError", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn(response));

    await expect(stashQuery("/v1/overview", z.object({}))).rejects.toMatchObject({
      name: "StashApiError", code: "transport_error", message: "The Stash request could not be completed.", requestId: "unknown", status: 0,
    } satisfies Partial<StashApiError>);
  });

  it("turns structured gateway failures into StashApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "forbidden",
      message: "You do not have access to this resource.",
      requestId: "request-2",
    }), { status: 403, headers: { "content-type": "application/json" } })));

    await expect(stashQuery("/v1/overview", z.object({}))).rejects.toMatchObject({
      name: "StashApiError",
      code: "forbidden",
      message: "You do not have access to this resource.",
      requestId: "request-2",
      status: 403,
    } satisfies Partial<StashApiError>);
  });

  it("rejects a response that does not meet its Zod contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: "yes" }), {
      headers: { "content-type": "application/json", "x-request-id": "request-3" },
    })));

    await expect(stashQuery("/v1/overview", z.object({ enabled: z.boolean() }))).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "request-3",
      status: 200,
    } satisfies Partial<StashApiError>);
  });
});
