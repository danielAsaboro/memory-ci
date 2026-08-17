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
const workspace = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  workspaceName: "Northstar",
  namespaceId: "namespace-1",
  agentId: "agent-1",
  roles: ["admin", "reviewer"],
};

async function session(overrides: Partial<typeof workspace> = {}, issuedAt = new Date()): Promise<string> {
  return signWorkspaceSession({ ...workspace, ...overrides }, sessionSecret, issuedAt);
}

function event(input: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  claims?: Record<string, unknown>;
  requestId?: string;
}) {
  return {
    path: input.path,
    httpMethod: input.method ?? "GET",
    headers: input.headers,
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
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
    const response = await handler(event({ path: "/health", requestId: "req-health" }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok", requestId: "req-health" });
  });

  it("bootstraps a workspace with a server key and idempotency key", async () => {
    const response = await handler(event({
      path: "/v1/workspaces",
      method: "POST",
      headers: { "x-stash-bootstrap-key": bootstrapKey, "idempotency-key": "bootstrap-1" },
      body: { displayName: "Northstar" },
      claims: { sub: "injected-principal", "custom:tenant_id": "injected-tenant" },
    }));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject(workspace);
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

  it("requires an idempotency key and bounded display name to bootstrap", async () => {
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

    expect(missingKey.statusCode).toBe(400);
    expect(oversizedName.statusCode).toBe(400);
  });

  it("accepts a signed Stash session for an active workspace principal", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session()}` },
    }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: "ready" });
  });

  it("rejects an expired session even when API Gateway injects Cognito claims", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      headers: { authorization: `Bearer ${await session({}, new Date(Date.now() - 2 * 86_400_000))}` },
      claims: { sub: "principal-1", "custom:tenant_id": "tenant-1", "cognito:groups": ["admin"] },
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
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

  it("ignores raw Cognito claims when no Stash bearer session is supplied", async () => {
    const response = await handler(event({
      path: "/v1/workspace/status",
      claims: { sub: "principal-1", "custom:tenant_id": "tenant-1", "cognito:groups": ["admin"] },
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
  });
});
