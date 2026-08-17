import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { createRouter } from "../api/router";
import { createWorkspaceSessionVerifier } from "../auth/workspace-session";
import { resolveDatabaseConnectionString } from "../aws/database-secret";
import { workspaceBootstrapSchema } from "../contracts/workspace";
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
const idempotencyKeySchema = z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const defaultAllowedOrigin = "https://trystash.xyz";

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
  const digest = (input: string) => createHash("sha256").update(input).digest();
  return timingSafeEqual(digest(requiredEnvironment("STASH_BOOTSTRAP_KEY")), digest(value ?? ""));
}

function allowedOrigin(): string {
  return process.env.ALLOWED_ORIGIN ?? defaultAllowedOrigin;
}

function requestOrigin(event: GatewayEvent): string | null {
  return new Headers(Object.entries(event.headers ?? {}).filter((item): item is [string, string] => typeof item[1] === "string"))
    .get("origin");
}

function traceRoot(): string | null {
  const root = process.env._X_AMZN_TRACE_ID?.match(/(?:^|;)Root=([^;]+)/)?.[1];
  return root && /^1-[0-9a-f]{8}-[0-9a-f]{24}$/i.test(root) ? root : null;
}

async function gatewayResponse(response: Response, origin: string | null, event?: GatewayEvent, requestId?: string) {
  const headers = new Headers(response.headers);
  if (origin === allowedOrigin()) {
    headers.set("access-control-allow-origin", allowedOrigin());
    headers.set("vary", "Origin");
  }
  const runId = event ? new Headers(Object.entries(event.headers ?? {}).filter((item): item is [string, string] => typeof item[1] === "string")).get("x-stash-evidence-run-id") : null;
  const root = traceRoot();
  if (root) headers.set("x-amzn-trace-id", `Root=${root}`);
  if (runId) headers.set("x-stash-evidence-run-id", runId);
  if (requestId && runId) process.stdout.write(`${JSON.stringify({ kind: "stash-api-request", requestId, traceId: root, runId })}\n`);
  return { statusCode: response.status, headers: Object.fromEntries(headers.entries()), body: await response.text() };
}

async function bootstrap(event: GatewayEvent, requestId: string) {
  const origin = requestOrigin(event);
  try {
    const request = toRequest(event, requestId);
    if (!hasBootstrapKey(request.headers.get("x-stash-bootstrap-key"))) {
      throw new DomainError("unauthorized", "Bootstrap authentication is required.");
    }
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!idempotencyKey.success) throw new DomainError("invalid_input", "Idempotency-Key header is invalid.");
    const parsed = bootstrapInput.safeParse(await parseJson(request));
    if (!parsed.success) throw new DomainError("invalid_input", "Workspace bootstrap input is invalid.");
    const runtime = await (runtimePromise ??= createRuntime());
    const bootstrapped = await bootstrapWorkspace(runtime.pool, {
      idempotencyKey: idempotencyKey.data,
      displayName: parsed.data.displayName,
    });
    const workspace = workspaceBootstrapSchema.parse({
      tenantId: bootstrapped.tenantId,
      principalId: bootstrapped.principalId,
      roles: bootstrapped.roles,
      workspaceName: bootstrapped.workspaceName,
    });
    return gatewayResponse(json(workspace, 201, requestId), origin, event, requestId);
  } catch (error) {
    return gatewayResponse(errorResponse(error, requestId), origin, event, requestId);
  }
}

export async function handler(event: GatewayEvent) {
  const requestId = event.requestContext?.requestId ?? crypto.randomUUID();
  const origin = requestOrigin(event);
  if ((event.rawPath ?? event.path) === "/health") return gatewayResponse(json({ status: "ok", requestId }), origin, event, requestId);
  if ((event.rawPath ?? event.path) === "/v1/workspaces" && event.httpMethod === "POST") return bootstrap(event, requestId);
  try {
    const runtime = await (runtimePromise ??= createRuntime());
    const router = createRouter({
      auth: createWorkspaceSessionVerifier(requiredEnvironment("STASH_SESSION_SECRET")),
      membership: { hasMembership: async (principalId, tenantId) => {
        const principal = await runtime.pool.query<{ id: string }>(
          "SELECT id FROM principals WHERE tenant_id=$1 AND id=$2 LIMIT 1", [tenantId, principalId],
        );
        return Boolean(principal.rows[0]);
      } },
      services: runtime.services,
      requestId: crypto.randomUUID,
    });
    return gatewayResponse(await router(toRequest(event, requestId)), origin, event, requestId);
  } catch (error) {
    return gatewayResponse(errorResponse(error, requestId), origin, event, requestId);
  }
}
