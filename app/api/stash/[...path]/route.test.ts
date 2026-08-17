import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signWorkspaceSession } from "../../../../src/auth/workspace-session";

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { GET, POST } from "./route";

const sessionSecret = "0123456789abcdef0123456789abcdef";
const session = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  roles: ["admin"],
  workspaceName: "Northstar",
};
const routeContext = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("/api/stash/[...path]", () => {
  beforeEach(() => {
    cookieStore.get.mockReset();
    cookieStore.get.mockReturnValue(undefined);
    vi.stubEnv("STASH_API_BASE_URL", "https://api.stash.test");
    vi.stubEnv("STASH_SESSION_SECRET", sessionSecret);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejects requests without a valid workspace session before contacting Stash", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "unauthorized", requestId: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only allowlisted request headers with a server-side bearer token and request ID", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workspace: "safe", apiToken: "must-not-reach-browser" }), {
      headers: {
        "content-type": "application/json",
        "x-request-id": "upstream-request-id",
        "cache-control": "private, no-store",
        "x-upstream-secret": "must-not-reach-browser",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview", {
      headers: { authorization: "Bearer attacker", cookie: "other=secret", "x-request-id": "attacker-id" },
    }), routeContext(["v1", "overview"]));

    expect(fetchMock).toHaveBeenCalledWith("https://api.stash.test/v1/overview", expect.objectContaining({
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "x-request-id": expect.stringMatching(/^[0-9a-f-]{36}$/i),
      },
    }));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("cookie");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("x-forwarded-for");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("x-request-id")).toBe("upstream-request-id");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-upstream-secret")).toBeNull();
    await expect(response.json()).resolves.toEqual({ workspace: "safe" });
  });

  it("requires a same-origin mutation and preserves its idempotency key", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://console.stash.test/api/stash/v1/candidates/candidate-1/screen", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://console.stash.test",
        "idempotency-key": "write-123",
      },
      body: "{}",
    });

    const response = await POST(request, routeContext(["v1", "candidates", "candidate-1", "screen"]));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://api.stash.test/v1/candidates/candidate-1/screen", expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({ "content-type": "application/json", "idempotency-key": "write-123" }),
    }));
  });

  it("rejects cross-origin mutations before forwarding them", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("https://console.stash.test/api/stash/v1/memory/search", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: "{}",
    }), routeContext(["v1", "memory", "search"]));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden", requestId: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects mutation bodies larger than 64 KiB before forwarding them", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("https://console.stash.test/api/stash/v1/memory/search", {
      method: "POST",
      headers: { origin: "https://console.stash.test", "content-type": "application/json" },
      body: "x".repeat(65_537),
    }), routeContext(["v1", "memory", "search"]));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "payload_too_large", requestId: expect.any(String) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a safe provider error without exposing upstream error details", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("STASH_API_KEY=do-not-leak")));

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "provider_unavailable",
      message: "Stash is unavailable.",
      requestId: expect.any(String),
    });
  });

  it("times out while consuming an upstream response body", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    let timeoutCallback: (() => void) | undefined;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
      if (delay === 10_000) timeoutCallback = callback as () => void;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    let fetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      fetchStarted?.();
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: vi.fn(() => new Promise<string>(() => {})),
      });
    }));

    const responsePromise = GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));
    await started;
    expect(timeoutCallback).toBeTypeOf("function");
    timeoutCallback?.();
    const response = await responsePromise;

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "provider_unavailable" });
  });
});
