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
const overview = {
  workspace: { id: "11111111-1111-4111-8111-111111111111", name: "Northstar" },
  metrics: { agents: 1, activeMemories: 2, candidates: 3, evaluations: 4, auditEvents: 5 },
};
const candidateDetail = {
  id: "11111111-1111-4111-8111-111111111111", namespaceId: "22222222-2222-4222-8222-222222222222", namespaceName: "Payments",
  lineageId: null, state: "review_required", memoryClass: "policy", trustClass: "authoritative", canonicalText: "Refunds require a verified account.",
  contentDigest: "a".repeat(64), source: { id: "33333333-3333-4333-8333-333333333333", uri: "https://source.test/refunds", signatureVerified: true },
  author: { id: "44444444-4444-4444-8444-444444444444", name: "Northstar Agent" }, findingCount: 1, blockingFindingCount: 0,
  createdAt: "2026-08-17T00:00:00.000Z", updatedAt: "2026-08-17T01:00:00.000Z",
};
const explanation = {
  memoryVersionId: "11111111-1111-4111-8111-111111111111", contentDigest: "a".repeat(64),
  provenance: { sourceType: "document", sourceUri: "https://source.test/refunds", trustClass: "authoritative", signatureIdentity: "verified-signer", signatureVerified: true },
  review: { decision: "approved", reason: "Reviewed", reviewerId: "22222222-2222-4222-8222-222222222222" },
  evaluation: { status: "passed", modelId: "model-1", providerRequestId: "provider-1", policyVersion: "v1" },
  activation: { eventType: "promoted", revision: 1, reason: "Approved" },
  relations: [{ relationType: "corroborates", confidence: 0.9, evidence: { internal: "not-for-browser" } }],
};

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

  it.each(["invalid", "expired"])("rejects an %s workspace session before contacting Stash", async (kind) => {
    const token = kind === "expired"
      ? await signWorkspaceSession(session, sessionSecret, new Date(Date.now() - 172_800_000))
      : "not-a-session";
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only allowlisted request headers with a server-side bearer token and request ID", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(overview), {
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-upstream-secret")).toBeNull();
    await expect(response.json()).resolves.toEqual(overview);
  });

  it("rejects an upstream success response with extra secret-bearing fields", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...overview, apiToken: "must-not-reach-browser" }), {
      headers: { "content-type": "application/json" },
    })));

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "provider_unavailable" });
  });

  it("projects a complete candidate detail response and rejects unknown provider fields", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(candidateDetail), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...candidateDetail, apiToken: "secret" }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const valid = await GET(new Request("https://console.stash.test/api/stash/v1/candidates/11111111-1111-4111-8111-111111111111"), routeContext(["v1", "candidates", "11111111-1111-4111-8111-111111111111"]));
    const extra = await GET(new Request("https://console.stash.test/api/stash/v1/candidates/11111111-1111-4111-8111-111111111111"), routeContext(["v1", "candidates", "11111111-1111-4111-8111-111111111111"]));

    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual(candidateDetail);
    expect(extra.status).toBe(502);
  });

  it("projects valid categorical explanation values and fails closed for invalid provider categories", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(explanation), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...explanation, provenance: { ...explanation.provenance, trustClass: "operator" } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const path = ["v1", "memory", "11111111-1111-4111-8111-111111111111", "explain"];

    const valid = await GET(new Request("https://console.stash.test/api/stash/v1/memory/11111111-1111-4111-8111-111111111111/explain"), routeContext(path));
    const invalid = await GET(new Request("https://console.stash.test/api/stash/v1/memory/11111111-1111-4111-8111-111111111111/explain"), routeContext(path));

    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual({
      memoryVersionId: explanation.memoryVersionId, contentDigest: explanation.contentDigest,
      provenance: { sourceType: "document", sourceUri: explanation.provenance.sourceUri, trustClass: "authoritative", signatureVerified: true },
      review: { decision: "approved" }, evaluation: { status: "passed", modelId: "model-1", policyVersion: "v1" },
      activation: { eventType: "promoted", revision: 1 }, relations: [{ relationType: "corroborates", confidence: 0.9 }],
    });
    expect(invalid.status).toBe(502);
  });

  it.each([
    ["provenance source type", { ...explanation, provenance: { ...explanation.provenance, sourceType: "database" } }, "database"],
    ["review decision", { ...explanation, review: { ...explanation.review!, decision: "deferred" } }, "deferred"],
    ["evaluation status", { ...explanation, evaluation: { ...explanation.evaluation!, status: "skipped" } }, "skipped"],
    ["activation event type", { ...explanation, activation: { ...explanation.activation!, eventType: "deleted" } }, "deleted"],
    ["relation type", { ...explanation, relations: [{ ...explanation.relations[0], relationType: "duplicates" }] }, "duplicates"],
  ])("fails closed without echoing an invalid %s", async (_label, providerResponse, invalidValue) => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(providerResponse), {
      headers: { "content-type": "application/json" },
    })));
    const path = ["v1", "memory", "11111111-1111-4111-8111-111111111111", "explain"];

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/memory/11111111-1111-4111-8111-111111111111/explain"), routeContext(path));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toMatchObject({ code: "provider_unavailable", message: "Stash is unavailable." });
    expect(body).not.toContain(invalidValue);
  });

  it("maps structured upstream errors to fixed safe messages", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: "unauthorized", message: "raw upstream secret: token", requestId: "upstream-request-1", apiToken: "secret",
    }), { status: 401, headers: { location: "https://attacker.test", "x-request-id": "upstream-request-1" } })));

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized", message: "Authentication is required.", requestId: "upstream-request-1",
    });
    expect(response.headers.get("location")).toBeNull();
  });

  it.each([
    ["wrong method", POST, ["v1", "overview"], "https://console.stash.test/api/stash/v1/overview"],
    ["unknown route", GET, ["v1", "unknown"], "https://console.stash.test/api/stash/v1/unknown"],
    ["encoded traversal", GET, ["v1", "memory", "%2e%2e"], "https://console.stash.test/api/stash/v1/memory/%252e%252e"],
    ["double encoding", GET, ["v1", "memory", "%252fprivate"], "https://console.stash.test/api/stash/v1/memory/%25252fprivate"],
  ])("rejects %s before forwarding", async (_label, handler, path, url) => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(url, handler === POST ? { method: "POST", headers: { origin: "https://console.stash.test" }, body: "{}" } : undefined);

    const response = await handler(request, routeContext(path));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow or expose upstream redirects", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://attacker.test" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));

    expect(response.status).toBe(502);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(response.headers.get("location")).toBeNull();
  });

  it("requires a same-origin mutation and preserves its idempotency key", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "11111111-1111-4111-8111-111111111111", state: "proposed", contentDigest: "a".repeat(64), provenanceVerified: true, redactions: [],
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://console.stash.test/api/stash/v1/candidates", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://console.stash.test",
        "idempotency-key": "write-123",
      },
      body: "{}",
    });

    const response = await POST(request, routeContext(["v1", "candidates"]));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://api.stash.test/v1/candidates", expect.objectContaining({
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

  it("times out while awaiting the upstream fetch", async () => {
    const token = await signWorkspaceSession(session, sessionSecret);
    cookieStore.get.mockReturnValue({ value: token });
    let timeoutCallback: (() => void) | undefined;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay) => {
      if (delay === 10_000) timeoutCallback = callback as () => void;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    });
    let fetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => {
      fetchStarted?.();
      return new Promise<Response>(() => {});
    }));

    const responsePromise = GET(new Request("https://console.stash.test/api/stash/v1/overview"), routeContext(["v1", "overview"]));
    await started;
    timeoutCallback?.();
    const response = await responsePromise;

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ code: "provider_unavailable" });
  });
});
