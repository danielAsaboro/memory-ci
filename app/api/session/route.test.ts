import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signWorkspaceSession, verifyWorkspaceSession } from "../../../src/auth/workspace-session";

const { cookieStore } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import { POST } from "./route";

const sessionSecret = "0123456789abcdef0123456789abcdef";
const workspace = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  roles: ["admin", "reviewer"],
  workspaceName: "Northstar",
};

describe("POST /api/session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    cookieStore.get.mockReset();
    cookieStore.get.mockReturnValue(undefined);
    vi.stubEnv("STASH_API_BASE_URL", "https://api.stash.test");
    vi.stubEnv("STASH_BOOTSTRAP_KEY", "bootstrap-key-for-tests-only");
    vi.stubEnv("STASH_SESSION_SECRET", sessionSecret);
    vi.stubEnv("NODE_ENV", "production");
  });

  it("bootstraps a workspace through AWS and returns only safe workspace metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...workspace,
      awsBootstrapSecret: "must-not-reach-the-browser",
      sessionToken: "must-not-reach-the-browser",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(workspace);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stash.test/v1/workspaces",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
          "X-Stash-Bootstrap-Key": "bootstrap-key-for-tests-only",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("stash_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=86400");

    const token = /stash_session=([^;]+)/.exec(setCookie ?? "")?.[1];
    await expect(verifyWorkspaceSession(token ?? "", sessionSecret)).resolves.toMatchObject(workspace);
  });

  it("uses a fresh idempotency key for each bootstrap request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(workspace), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await POST();
    await POST();

    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).not.toBe(
      fetchMock.mock.calls[1][1].headers["Idempotency-Key"],
    );
  });

  it("keeps the session cookie Secure even when an E2E flag or forged Host is present", async () => {
    vi.stubEnv("STASH_E2E", "1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(workspace), { status: 201 })));
    const response = await POST();
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("reuses a valid workspace cookie without calling the bootstrap endpoint", async () => {
    cookieStore.get.mockReturnValue({
      value: await signWorkspaceSession(workspace, sessionSecret),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();

    await expect(response.json()).resolves.toEqual(workspace);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces a stale workspace cookie through a fresh bootstrap", async () => {
    cookieStore.get.mockReturnValue({ value: "stale-session-token" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(workspace), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(workspace);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("stash_session=");
  });

  it.each([
    ["invalid JSON", () => new Response("{", { status: 201 })],
    ["missing workspace claims", () => new Response(JSON.stringify({ tenantId: "tenant-1" }), { status: 201 })],
  ])("fails closed when the bootstrap provider returns %s", async (_label, createResponse) => {
    const fetchMock = vi.fn().mockResolvedValue(createResponse());
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "provider_unavailable",
      message: "Workspace bootstrap returned an invalid response.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("aborts a hung bootstrap after 10 seconds without setting a session cookie", async () => {
    let timeoutCallback: (() => void) | undefined;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
      if (delay === 10_000) timeoutCallback = callback as () => void;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      (init?.signal as AbortSignal).addEventListener("abort", () => reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const responsePromise = POST();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(timeoutCallback).toBeTypeOf("function");
    timeoutCallback?.();
    const response = await responsePromise;

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "provider_unavailable",
      message: "Workspace bootstrap is unavailable.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("aborts a bootstrap whose response body stalls after headers", async () => {
    vi.useFakeTimers();
    const responseBody = new Promise<unknown>(() => {});
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn(() => responseBody),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    let result: Response | undefined;
    void POST().then((response) => { result = response; });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.resolve();

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "provider_unavailable",
      message: "Workspace bootstrap is unavailable.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("fails closed when the server API URL is malformed", async () => {
    vi.stubEnv("STASH_API_BASE_URL", "not-a-url");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: "provider_unavailable",
      message: "Workspace sessions are not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
