import { cookies } from "next/headers";
import { z, type ZodType } from "zod";

import { verifyWorkspaceSession } from "../../../../src/auth/workspace-session";
import {
  agentSchema, auditEventSchema, candidateStateSchema, candidateSummarySchema, evaluationDetailSchema,
  evaluationSummarySchema, identifierSchema, memoryClassSchema, memoryDetailSchema, memorySummarySchema,
  nullableTimestampSchema, overviewSchema, timestampSchema, trustClassSchema, workspaceStatusSchema,
} from "../../../../src/contracts/dashboard";

const COOKIE_NAME = "stash_session";
const MAX_BODY_BYTES = 64 * 1024;
const PROXY_TIMEOUT_MS = 10_000;
const stableIdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const upstreamRequestIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/);

const internalCandidateSchema = z.object({
  id: identifierSchema, tenantId: identifierSchema, namespaceId: identifierSchema, lineageId: identifierSchema.nullable(),
  state: candidateStateSchema, memoryClass: memoryClassSchema, trustClass: trustClassSchema,
  canonicalPayload: z.record(z.string(), z.unknown()), contentDigest: z.string().min(1).max(128),
  sourceId: identifierSchema, createdBy: identifierSchema, createdAt: timestampSchema,
}).strict();
const internalMemorySchema = z.object({
  id: identifierSchema, tenantId: identifierSchema, namespaceId: identifierSchema, lineageId: identifierSchema,
  candidateId: identifierSchema, version: z.number().int().positive(), revision: z.number().int().positive(),
  active: z.boolean(), canonicalPayload: z.record(z.string(), z.unknown()), contentDigest: z.string().min(1).max(128),
  validFrom: timestampSchema, validUntil: nullableTimestampSchema,
}).strict();
const candidateReceiptSchema = z.object({
  id: identifierSchema, state: candidateStateSchema, contentDigest: z.string().min(1).max(128),
  provenanceVerified: z.boolean(), redactions: z.array(z.string().min(1).max(255)),
}).strict();
const screenResponseSchema = z.object({
  candidate: internalCandidateSchema,
  findings: z.array(z.object({
    ruleId: z.string().min(1).max(100), severity: z.enum(["low", "medium", "high", "critical"]),
    message: z.string().min(1).max(500), evidence: z.string().max(500).optional(),
  }).strict()),
}).strict();
const evaluationQueuedSchema = z.object({ candidateId: identifierSchema, status: z.literal("queued"), eventId: identifierSchema }).strict();
const internalReviewSchema = z.object({
  id: identifierSchema, candidateId: identifierSchema, reviewerId: identifierSchema,
  decision: z.enum(["approved", "rejected", "quarantined"]), reason: z.string().min(1).max(2_000),
  candidateDigest: z.string().min(1).max(128), evaluationRunId: identifierSchema,
  baselineRevision: z.number().int().nonnegative(), policyVersion: z.string().min(1).max(255),
}).strict();
const memorySearchSchema = z.object({
  namespaceId: identifierSchema, revision: z.number().int().nonnegative(), memories: z.array(internalMemorySchema),
}).strict();
const explanationSchema = z.object({
  memoryVersionId: identifierSchema, contentDigest: z.string().min(1).max(128),
  provenance: z.object({
    sourceType: z.string().min(1).max(255), sourceUri: z.string().max(2_000).nullable(), trustClass: z.string().min(1).max(255),
    signatureIdentity: z.string().max(500).nullable(), signatureVerified: z.boolean(),
  }).strict(),
  review: z.object({ decision: z.string().min(1).max(255), reason: z.string().min(1).max(2_000), reviewerId: identifierSchema }).strict().nullable(),
  evaluation: z.object({ status: z.string().min(1).max(255), modelId: z.string().max(255).nullable(), providerRequestId: z.string().max(255).nullable(), policyVersion: z.string().min(1).max(255) }).strict().nullable(),
  activation: z.object({ eventType: z.string().min(1).max(255), revision: z.number().int().nonnegative(), reason: z.string().min(1).max(2_000) }).strict().nullable(),
  relations: z.array(z.object({ relationType: z.string().min(1).max(255), confidence: z.number().min(0).max(1), evidence: z.record(z.string(), z.unknown()) }).strict()),
}).strict();
const namespaceRevisionSchema = z.object({ namespaceId: identifierSchema, revision: z.number().int().nonnegative() }).strict();

type RouteContext = { params: Promise<{ path: string[] }> };
type GatewayConfig = { apiBaseUrl: string; sessionSecret: string };
type RouteDefinition = { method: "GET" | "POST"; segments: readonly (string | "id")[]; schema: ZodType; project: (value: unknown) => unknown };

const identity = (value: unknown) => value;
const publicCandidate = (value: z.infer<typeof internalCandidateSchema>) => ({
  id: value.id, namespaceId: value.namespaceId, lineageId: value.lineageId, state: value.state,
  memoryClass: value.memoryClass, trustClass: value.trustClass, contentDigest: value.contentDigest, createdAt: value.createdAt,
});
const publicMemory = (value: z.infer<typeof internalMemorySchema>) => ({
  id: value.id, namespaceId: value.namespaceId, lineageId: value.lineageId, candidateId: value.candidateId,
  version: value.version, revision: value.revision, active: value.active, contentDigest: value.contentDigest,
  validFrom: value.validFrom, validUntil: value.validUntil,
});
const projectScreen = (value: unknown) => {
  const response = screenResponseSchema.parse(value);
  return { candidate: publicCandidate(response.candidate), findings: response.findings.map(({ ruleId, severity, message }) => ({ ruleId, severity, message })) };
};
const projectReview = (value: unknown) => {
  const review = internalReviewSchema.parse(value);
  return { id: review.id, candidateId: review.candidateId, decision: review.decision, evaluationRunId: review.evaluationRunId, baselineRevision: review.baselineRevision, policyVersion: review.policyVersion };
};
const projectMemory = (value: unknown) => publicMemory(internalMemorySchema.parse(value));
const projectMemorySearch = (value: unknown) => {
  const result = memorySearchSchema.parse(value);
  return { namespaceId: result.namespaceId, revision: result.revision, memories: result.memories.map(publicMemory) };
};
const projectExplanation = (value: unknown) => {
  const explanation = explanationSchema.parse(value);
  return {
    memoryVersionId: explanation.memoryVersionId, contentDigest: explanation.contentDigest,
    provenance: { sourceType: explanation.provenance.sourceType, sourceUri: explanation.provenance.sourceUri, trustClass: explanation.provenance.trustClass, signatureVerified: explanation.provenance.signatureVerified },
    review: explanation.review ? { decision: explanation.review.decision } : null,
    evaluation: explanation.evaluation ? { status: explanation.evaluation.status, modelId: explanation.evaluation.modelId, policyVersion: explanation.evaluation.policyVersion } : null,
    activation: explanation.activation ? { eventType: explanation.activation.eventType, revision: explanation.activation.revision } : null,
    relations: explanation.relations.map(({ relationType, confidence }) => ({ relationType, confidence })),
  };
};

const routes: readonly RouteDefinition[] = [
  { method: "GET", segments: ["v1", "overview"], schema: overviewSchema, project: identity },
  { method: "GET", segments: ["v1", "agents"], schema: z.array(agentSchema), project: identity },
  { method: "GET", segments: ["v1", "memory"], schema: z.array(memorySummarySchema), project: identity },
  { method: "GET", segments: ["v1", "memory", "id"], schema: memoryDetailSchema, project: identity },
  { method: "POST", segments: ["v1", "candidates"], schema: candidateReceiptSchema, project: identity },
  { method: "GET", segments: ["v1", "candidates"], schema: z.array(candidateSummarySchema), project: identity },
  { method: "GET", segments: ["v1", "candidates", "id"], schema: candidateSummarySchema, project: identity },
  { method: "POST", segments: ["v1", "candidates", "id", "screen"], schema: screenResponseSchema, project: projectScreen },
  { method: "POST", segments: ["v1", "candidates", "id", "evaluate"], schema: evaluationQueuedSchema, project: identity },
  { method: "POST", segments: ["v1", "candidates", "id", "reviews"], schema: internalReviewSchema, project: projectReview },
  { method: "POST", segments: ["v1", "candidates", "id", "promote"], schema: internalMemorySchema, project: projectMemory },
  { method: "POST", segments: ["v1", "lineages", "id", "rollback"], schema: internalMemorySchema, project: projectMemory },
  { method: "POST", segments: ["v1", "memory", "search"], schema: memorySearchSchema, project: projectMemorySearch },
  { method: "GET", segments: ["v1", "memory", "id", "explain"], schema: explanationSchema, project: projectExplanation },
  { method: "GET", segments: ["v1", "namespaces", "id", "revision"], schema: namespaceRevisionSchema, project: identity },
  { method: "GET", segments: ["v1", "evaluations"], schema: z.array(evaluationSummarySchema), project: identity },
  { method: "GET", segments: ["v1", "evaluations", "id"], schema: evaluationDetailSchema, project: identity },
  { method: "GET", segments: ["v1", "audit"], schema: z.array(auditEventSchema), project: identity },
  { method: "GET", segments: ["v1", "workspace", "status"], schema: workspaceStatusSchema, project: identity },
];

export async function GET(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return proxy(request, context); }

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const requestId = crypto.randomUUID();
  const { path } = await context.params;
  const route = matchRoute(request.method, path);
  if (!route || new URL(request.url).search) return gatewayError("not_found", "The requested route was not found.", 404, requestId);
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
    const upstream = await beforeAbort(fetch(upstreamUrl(config.apiBaseUrl, path), {
      method: request.method, signal: controller.signal, redirect: "manual", headers: forwardHeaders(request, token, requestId),
      ...(requestBody === undefined ? {} : { body: requestBody }),
    }), controller.signal);
    if (upstream.status >= 300 && upstream.status < 400) return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
    const body = await beforeAbort(upstream.text(), controller.signal);
    if (!upstream.ok) return safeUpstreamError(upstream, body, requestId);
    const parsed = route.schema.safeParse(parseJson(body));
    if (!parsed.success) return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
    return jsonResponse(route.project(parsed.data), upstreamRequestId(upstream.headers, requestId), upstream.status);
  } catch {
    return gatewayError("provider_unavailable", "Stash is unavailable.", 502, requestId);
  } finally { clearTimeout(timer); }
}

function matchRoute(method: string, path: string[]): RouteDefinition | undefined {
  return routes.find((route) => route.method === method && route.segments.length === path.length && route.segments.every((segment, index) => segment === "id" ? stableIdentifierSchema.safeParse(path[index]).success : segment === path[index]));
}
function upstreamUrl(apiBaseUrl: string, path: string[]): string {
  const url = new URL(apiBaseUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  url.pathname = `${basePath}/${path.join("/")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}
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
function safeUpstreamError(upstream: Response, body: string, requestId: string): Response {
  const upstreamId = requestIdFromBody(body) ?? upstreamRequestId(upstream.headers, requestId);
  if (upstream.status === 400) return gatewayError("invalid_input", "The request is invalid.", 400, upstreamId);
  if (upstream.status === 401) return gatewayError("unauthorized", "Authentication is required.", 401, upstreamId);
  if (upstream.status === 403) return gatewayError("forbidden", "You do not have access to this resource.", 403, upstreamId);
  if (upstream.status === 404) return gatewayError("not_found", "The requested resource was not found.", 404, upstreamId);
  if (upstream.status === 409) return gatewayError("conflict", "The request conflicts with current state.", 409, upstreamId);
  if (upstream.status === 422) return gatewayError("inconclusive", "The operation was inconclusive.", 422, upstreamId);
  return gatewayError("provider_unavailable", "Stash is unavailable.", 502, upstreamId);
}
function requestIdFromBody(body: string): string | null {
  const parsed = z.object({ requestId: upstreamRequestIdSchema }).passthrough().safeParse(parseJson(body));
  return parsed.success ? parsed.data.requestId : null;
}
function upstreamRequestId(headers: Headers, fallback: string): string {
  const parsed = upstreamRequestIdSchema.safeParse(headers.get("x-request-id"));
  return parsed.success ? parsed.data : fallback;
}
function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function jsonResponse(value: unknown, requestId: string, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId } });
}
function gatewayError(code: string, message: string, status: number, requestId: string): Response { return jsonResponse({ code, message, requestId }, requestId, status); }
class PayloadTooLargeError extends Error {}
