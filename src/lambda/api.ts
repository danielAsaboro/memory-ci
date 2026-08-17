import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { createRouter } from "../api/router";
import { createWorkspaceSessionVerifier } from "../auth/workspace-session";
import { resolveDatabaseConnectionString } from "../aws/database-secret";
import { createPool } from "../db/client";
import { DomainError } from "../domain/errors";
import { errorResponse, json, parseJson } from "../api/http";
import { bootstrapWorkspace, createApiServices } from "./services";

type GatewayEvent = {
  httpMethod?: string; rawPath?: string; path?: string; body?: string | null; isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>; queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string };
};

const bootstrapInput = z.object({ displayName: z.string().trim().min(1).max(120) }).strict();

let runtimePromise: ReturnType<typeof createRuntime> | undefined;
async function createRuntime() {
  const pool = createPool(await resolveDatabaseConnectionString());
  return { pool, services: createApiServices(pool) };
}

function toRequest(event: GatewayEvent, requestId: string): Request {
  const path = event.rawPath ?? event.path ?? "/";
  const query = new URLSearchParams(Object.entries(event.queryStringParameters ?? {}).filter((item): item is [string, string] => typeof item[1] === "string"));
  const headers = new Headers(Object.entries(event.headers ?? {}).filter((item): item is [string, string] => typeof item[1] === "string"));
  headers.set("x-request-id", requestId);
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : undefined;
  return new Request(`https://trystash.xyz${path}${query.size ? `?${query}` : ""}`, {
    method: event.httpMethod ?? "GET", headers, body: ["GET", "HEAD"].includes(event.httpMethod ?? "GET") ? undefined : body,
  });
}

function requiredEnvironment(name: "STASH_SESSION_SECRET" | "STASH_BOOTSTRAP_KEY"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hasBootstrapKey(value: string | null): boolean {
  if (!value) return false;
  const expected = Buffer.from(requiredEnvironment("STASH_BOOTSTRAP_KEY"));
  const received = Buffer.from(value);
  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
}

async function gatewayResponse(response: Response) {
  return { statusCode: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
}

async function bootstrap(event: GatewayEvent, requestId: string) {
  try {
    const request = toRequest(event, requestId);
    if (!hasBootstrapKey(request.headers.get("x-stash-bootstrap-key"))) {
      throw new DomainError("unauthorized", "Bootstrap authentication is required.");
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey) throw new DomainError("invalid_input", "Idempotency-Key header is required.");
    const parsed = bootstrapInput.safeParse(await parseJson(request));
    if (!parsed.success) throw new DomainError("invalid_input", "Workspace bootstrap input is invalid.");
    const runtime = await (runtimePromise ??= createRuntime());
    return gatewayResponse(json(await bootstrapWorkspace(runtime.pool, { idempotencyKey, displayName: parsed.data.displayName }), 201, requestId));
  } catch (error) {
    return gatewayResponse(errorResponse(error, requestId));
  }
}

export async function handler(event: GatewayEvent) {
  const requestId = event.requestContext?.requestId ?? crypto.randomUUID();
  if ((event.rawPath ?? event.path) === "/health") return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ok", requestId }) };
  if ((event.rawPath ?? event.path) === "/v1/workspaces" && event.httpMethod === "POST") return bootstrap(event, requestId);
  try {
    const runtime = await (runtimePromise ??= createRuntime());
    const router = createRouter({
      auth: createWorkspaceSessionVerifier(requiredEnvironment("STASH_SESSION_SECRET")),
      membership: { hasMembership: async (principalId, tenantId) => {
        const principal = await runtime.pool.query<{ id: string }>(
          "SELECT id FROM principals WHERE tenant_id=$1 AND id=$2 AND active LIMIT 1", [tenantId, principalId],
        );
        return Boolean(principal.rows[0]);
      } },
      services: runtime.services,
      requestId: crypto.randomUUID,
    });
    return gatewayResponse(await router(toRequest(event, requestId)));
  } catch (error) {
    return gatewayResponse(errorResponse(error, requestId));
  }
}
