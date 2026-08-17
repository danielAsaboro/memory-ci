import { beforeEach, describe, expect, it, vi } from "vitest";

import { signWorkspaceSession } from "../auth/workspace-session";

const runtime = vi.hoisted(() => ({
  bootstrapWorkspace: vi.fn(),
  pool: { query: vi.fn() },
  services: { getWorkspaceStatus: vi.fn() },
}));

vi.mock("../aws/database-secret", () => ({
  resolveDatabaseConnectionString: async () => "postgresql://example.invalid/stash",
}));

vi.mock("../db/client", () => ({
  createPool: () => runtime.pool,
}));

vi.mock("./services", () => ({
  bootstrapWorkspace: runtime.bootstrapWorkspace,
  createApiServices: () => runtime.services,
}));

import { handler } from "./api";

const sessionSecret = "0123456789abcdef0123456789abcdef";
const bootstrapKey = "abcdef0123456789abcdef0123456789";
const wrongBootstrapKey = "abcdef0123456789abcdef0123456788";
const wrongSessionSecret = "fedcba9876543210fedcba9876543210";
const allowedOrigin = "https://trystash.xyz";
const workspace = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  workspaceName: "Northstar",
  namespaceId: "namespace-1",
  agentId: "agent-1",
  roles: ["admin", "reviewer"],
};
const publicWorkspace = {
  tenantId: workspace.tenantId,
  principalId: workspace.principalId,
  workspaceName: workspace.workspaceName,
  roles: workspace.roles,
};

async function session(overrides: Partial<typeof workspace> = {}, issuedAt = new Date()): Promise<string> {
  return signWorkspaceSession({ ...workspace, ...overrides }, sessionSecret, issuedAt);
}

function event(input: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  claims?: Record<string, unknown>;
  requestId?: string;
}) {
  return {
    path: input.path,
    httpMethod: input.method ?? "GET",
    headers: input.headers,
    body: input.rawBody ?? (input.body === undefined ? undefined : JSON.stringify(input.body)),
    requestContext: {
      requestId: input.requestId ?? "req-api",
      authorizer: input.claims ? { claims: input.claims } : undefined,
    },
  };
}

describe("API Gateway Lambda adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STASH_SESSION_SECRET = sessionSecret;
    process.env.STASH_BOOTSTRAP_KEY = bootstrapKey;
    process.env.ALLOWED_ORIGIN = allowedOrigin;
    runtime.pool.query.mockImplementation(async (_query: string, values: readonly string[]) => ({
      rows: values[0] === "tenant-1" && values[1] === "principal-1" ? [{ id: "principal-1" }] : [],
    }));
    runtime.services.getWorkspaceStatus.mockResolvedValue({ status: "ready" });
    runtime.bootstrapWorkspace.mockImplementation(async (_pool, input) => {
      if (input.idempotencyKey !== "bootstrap-1") throw new Error("Unexpected idempotency key");
      return { ...workspace, workspaceName: input.displayName };
    });
  });

  it("serves a dependency-free health check", async () => {
    const response = await handler(event({
      path: "/health",
      headers: { origin: allowedOrigin },
      requestId: "req-health",
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok", requestId: "req-health" });
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("bootstraps a workspace with a server key and idempotency key", async () => {
    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap-1", origin: allowedOrigin },
      body: { displayName: "Northstar" },
      claims: { sub: "injected-principal", "custom:tenant_id": "injected-tenant" },
    }));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual(publicWorkspace);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("does not expose non-public bootstrap fields returned by a service", async () => {
    runtime.bootstrapWorkspace.mockResolvedValueOnce({ ...workspace, internalBootstrapKey: "do-not-leak" });

    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap-1", origin: allowedOrigin },
      body: { displayName: "Northstar" },
    }));

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain("do-not-leak");
    expect(JSON.parse(response.body)).toEqual(publicWorkspace);
  });

  it("rejects bootstrap requests without the server key", async () => {
    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "idempotency-key": "bootstrap-1" },
      body: { displayName: "Northstar" },
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
  });

  it("rejects a wrong bootstrap key with an allowed-origin error response", async () => {
    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": wrongBootstrapKey, "idempotency-key": "bootstrap-1", origin: allowedOrigin },
      body: { displayName: "Northstar" },
    }));

    expect(response.statusCode).toBe(401);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("requires a safe idempotency key and bounded display name to bootstrap", async () => {
    const missingKey = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey },
      body: { displayName: "Northstar" },
    }));
    const oversizedName = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap-1" },
      body: { displayName: "x".repeat(121) },
    }));
    const whitespaceKey = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "   " },
      body: { displayName: "Northstar" },
    }));
    const oversizedKey = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "x".repeat(256) },
      body: { displayName: "Northstar" },
    }));
    const unsafeKey = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap key" },
      body: { displayName: "Northstar" },
    }));

    expect(missingKey.statusCode).toBe(400);
    expect(oversizedName.statusCode).toBe(400);
    expect(whitespaceKey.statusCode).toBe(400);
    expect(oversizedKey.statusCode).toBe(400);
    expect(unsafeKey.statusCode).toBe(400);
  });

  it("rejects malformed bootstrap JSON with an allowed-origin error response", async () => {
    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap-1", origin: allowedOrigin },
      rawBody: "{not-json",
    }));

    expect(response.statusCode).toBe(400);
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("accepts a signed Stash session for an active workspace principal", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session()}`, origin: allowedOrigin },
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: "ready" });
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("does not grant CORS to an arbitrary lifecycle request origin", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session()}`, origin: "https://attacker.example" },
    }));

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a session signed with another secret", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await signWorkspaceSession(workspace, wrongSessionSecret)}` },
    }));

    expect(response.statusCode).toBe(401);
  });

  it("rejects an expired session even when API Gateway injects Cognito claims", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: {
        authorization: `Bearer ${await session({}, new Date(Date.now() - 2 * 86_400_000))}`,
        origin: allowedOrigin,
      },
      claims: { sub: "principal-1", "custom:tenant_id": "tenant-1", "cognito:groups": ["admin"] },
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
    expect(response.headers["access-control-allow-origin"]).toBe(allowedOrigin);
  });

  it("forbids a session whose tenant does not contain its active principal", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session({ tenantId: "tenant-2" })}` },
      claims: { sub: "principal-1", "custom:tenant_id": "tenant-1", "cognito:groups": ["admin"] },
    }));

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).code).toBe("forbidden");
  });

  it("forbids an inactive principal in the signed session tenant", async () => {
    runtime.pool.query.mockResolvedValueOnce({ rows: [] });

    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session()}` },
    }));

    expect(response.statusCode).toBe(403);
  });

  it("ignores raw Cognito claims when no Stash bearer session is supplied", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      claims: { sub: "principal-1", "custom:tenant_id": "tenant-1", "cognito:groups": ["admin"] },
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
  });
});
