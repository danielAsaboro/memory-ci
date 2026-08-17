import { cookies } from "next/headers";
import { z } from "zod";

import { verifyWorkspaceSession } from "../../../../src/auth/workspace-session";

const COOKIE_NAME = "stash_session";
const MAX_BODY_BYTES = 64 * 1024;
const PROXY_TIMEOUT_MS = 10_000;

const allowedRoutes = [
  ["GET", /^\/v1\/overview$/], ["GET", /^\/v1\/agents$/], ["GET", /^\/v1\/memory$/],
  ["GET", /^\/v1\/memory\/[^/]+$/], ["POST", /^\/v1\/candidates$/], ["GET", /^\/v1\/candidates$/],
  ["GET", /^\/v1\/candidates\/[^/]+$/], ["POST", /^\/v1\/candidates\/[^/]+\/screen$/],
  ["POST", /^\/v1\/candidates\/[^/]+\/evaluate$/], ["POST", /^\/v1\/candidates\/[^/]+\/reviews$/],
  ["POST", /^\/v1\/candidates\/[^/]+\/promote$/], ["POST", /^\/v1\/lineages\/[^/]+\/rollback$/],
  ["POST", /^\/v1\/memory\/search$/], ["GET", /^\/v1\/memory\/[^/]+\/explain$/],
  ["GET", /^\/v1\/namespaces\/[^/]+\/revision$/], ["GET", /^\/v1\/evaluations$/],
  ["GET", /^\/v1\/evaluations\/[^/]+$/], ["GET", /^\/v1\/audit$/], ["GET", /^\/v1\/workspace\/status$/],
] as const;

const errorSchema = z.object({
  code: z.string().min(1), message: z.string().min(1), requestId: z.string().min(1),
}).strict();

type RouteContext = { params: Promise<{ path: string[] }> };
type GatewayConfig = { apiBaseUrl: string; sessionSecret: string };

export async function GET(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context); }

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const { path } = await context.params;
  const upstreamPath = `/${path.join("/")}`;
  if (!isAllowed(request.method, upstreamPath)) return gatewayError("not_found", "The requested route was not found.", 404, requestId);
  if (request.method !== "GET" && !isSameOrigin(request)) return gatewayError("forbidden", "This request must come from the Stash console.", 403, requestId);

  let config: GatewayConfig;
  try { config = readConfig(); } catch { return gatewayError("provider_unavailable", "Stash is unavailable.", 500, requestId); }

  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return gatewayError("unauthorized", "Authentication is required.", 401, requestId);
  try { await verifyWorkspaceSession(token, config.sessionSecret); } catch { return gatewayError("unauthorized", "Authentication is required.", 401, requestId); }

  let requestBody: string | undefined;
  try { requestBody = await readBoundedRequestBody(request); } catch (error) {
    if (error instanceof PayloadTooLargeError) return gatewayError("payload_too_large", "Request body must not exceed 64 KiB.", 413, requestId);
    return gatewayError("invalid_input", "Request body could not be read.", 400, requestId);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const upstream = await beforeAbort(fetch(`${config.apiBaseUrl}${upstreamPath}`, {
      method: request.method, signal: controller.signal, headers: forwardHeaders(request, token, requestId),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    }), controller.signal);
    const body = await beforeAbort(upstream.text(), controller.signal);
    if (!upstream.ok) return safeUpstreamError(upstream, body, requestId);
    const safeBody = removeSecrets(body);
    if (safeBody === null) return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
    return new Response(safeBody, { status: upstream.status, headers: responseHeaders(upstream.headers, requestId) });
  } catch {
    return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
  } finally { clearTimeout(timer); }
}

function isAllowed(method: string, path: string): boolean { return allowedRoutes.some(([allowedMethod, pattern]) => allowedMethod === method && pattern.test(path)); }
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
function readConfig(): GatewayConfig {
  const apiBaseUrl = requiredHttpUrl("STASH_API_BASE_URL");
  const sessionSecret = requiredEnv("STASH_SESSION_SECRET");
  if (new TextEncoder().encode(sessionSecret).byteLength < 32) throw new Error("STASH_SESSION_SECRET must be at least 32 bytes.");
  return { apiBaseUrl, sessionSecret };
}
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
function requiredHttpUrl(name: string): string {
  const url = new URL(requiredEnv(name));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP or HTTPS.`);
  return url.toString().replace(/\/$/, "");
}
function forwardHeaders(request: Request, token: string, requestId: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "x-request-id": requestId };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  return headers;
}
async function readBoundedRequestBody(request: Request): Promise<string | undefined> {
  if (request.method === "GET" || !request.body) return undefined;
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new PayloadTooLargeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
async function beforeAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("Stash proxy timed out.");
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Stash proxy timed out."));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, aborted]); } finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}
function responseHeaders(upstream: Headers, requestId: string): Headers {
  const headers = new Headers({
    "content-type": upstream.get("content-type") ?? "application/json; charset=utf-8",
    "x-request-id": upstream.get("x-request-id") ?? requestId,
    "cache-control": "no-store",
  });
  const cacheControl = upstream.get("cache-control");
  if (cacheControl && isSafeCacheControl(cacheControl)) headers.set("cache-control", cacheControl);
  return headers;
}
function isSafeCacheControl(value: string): boolean { return value.split(",").some((directive) => directive.trim().toLowerCase() === "no-store"); }
function safeUpstreamError(upstream: Response, body: string, requestId: string): Response {
  const error = errorSchema.safeParse(parseJson(body));
  if (!error.success) return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
  return new Response(JSON.stringify(error.data), { status: upstream.status, headers: responseHeaders(upstream.headers, error.data.requestId) });
}
function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function removeSecrets(body: string): string | null {
  const value = parseJson(body);
  if (value === null) return null;
  return JSON.stringify(redact(value));
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, nested]) => (
    /(?:secret|token|password|authorization|credential|api[-_]?key|private[-_]?key)/i.test(key) ? [] : [[key, redact(nested)]]
  )));
}
function gatewayError(code: string, message: string, status: number, requestId: string): Response {
  return new Response(JSON.stringify({ code, message, requestId }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId } });
}
class PayloadTooLargeError extends Error {}
