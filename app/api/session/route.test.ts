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
