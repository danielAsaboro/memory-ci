import { createRouter } from "../api/router";
import { resolveDatabaseConnectionString } from "../aws/database-secret";
import { createPool } from "../db/client";
import { DomainError } from "../domain/errors";
import { createApiServices } from "./services";

type GatewayEvent = {
  httpMethod?: string; rawPath?: string; path?: string; body?: string | null; isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>; queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: { requestId?: string; authorizer?: { claims?: Record<string, unknown> } };
};

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
  if (!headers.has("authorization")) headers.set("authorization", "Bearer cognito-authorized");
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : undefined;
  return new Request(`https://memory-ci.internal${path}${query.size ? `?${query}` : ""}`, {
    method: event.httpMethod ?? "GET", headers, body: ["GET", "HEAD"].includes(event.httpMethod ?? "GET") ? undefined : body,
  });
}

export async function handler(event: GatewayEvent) {
  const requestId = event.requestContext?.requestId ?? crypto.randomUUID();
  if ((event.rawPath ?? event.path) === "/health") return { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ok", requestId }) };
  const claims = event.requestContext?.authorizer?.claims;
  if (!claims) return { statusCode: 401, headers: { "content-type": "application/json", "x-request-id": requestId }, body: JSON.stringify({ code: "unauthorized", message: "Authentication is required.", requestId }) };
  const tenantId = claims["custom:tenant_id"];
  const subject = claims.sub;
  if (typeof tenantId !== "string" || typeof subject !== "string") throw new DomainError("unauthorized", "Cognito claims are incomplete.");
  const runtime = await (runtimePromise ??= createRuntime());
  const principal = await runtime.pool.query<{ id: string }>(
    "SELECT id FROM principals WHERE tenant_id=$1 AND external_subject=$2 AND active LIMIT 1", [tenantId, subject],
  );
  if (!principal.rows[0]) return { statusCode: 403, headers: { "content-type": "application/json", "x-request-id": requestId }, body: JSON.stringify({ code: "forbidden", message: "You do not have access to this resource.", requestId }) };
  const groups = claims["cognito:groups"];
  const roles = Array.isArray(groups) ? groups.filter((value): value is string => typeof value === "string") : typeof groups === "string" ? groups.split(",") : [];
  const router = createRouter({
    auth: { verify: async () => ({ subject: principal.rows[0]!.id, tenantId, roles }) },
    membership: { hasMembership: async () => true }, services: runtime.services, requestId: crypto.randomUUID,
  });
  const response = await router(toRequest(event, requestId));
  return { statusCode: response.status, headers: Object.fromEntries(response.headers.entries()), body: await response.text() };
}
