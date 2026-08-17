import { z, type ZodType } from "zod";

import { candidateInputSchema } from "../contracts/candidate";
import { DomainError } from "../domain/errors";
import { readBearerToken, type AuthClaims, type AuthVerifier } from "./auth";
import { errorResponse, json, parseJson } from "./http";

export type ApiContext = Readonly<{
  tenantId: string; principalId: string; requestId: string; roles: readonly string[];
}>;
type Service = (context: ApiContext, input: Record<string, unknown>) => Promise<unknown>;
export type ApiServices = Readonly<{
  getOverview: Service; listAgents: Service; listMemories: Service; getMemory: Service;
  listEvaluations: Service; getEvaluation: Service; listCandidates: Service; getCandidate: Service;
  listAudit: Service; getWorkspaceStatus: Service; createCandidate: Service; screenCandidate: Service;
  evaluateCandidate: Service; reviewCandidate: Service; promoteCandidate: Service; rollbackLineage: Service;
  searchMemory: Service; explainMemory: Service; namespaceRevision: Service;
}>;

export type ApiDependencies = Readonly<{
  auth: AuthVerifier;
  membership: { hasMembership(subject: string, tenantId: string): Promise<boolean> };
  services: ApiServices;
  requestId(): string;
}>;

const identifier = z.string().min(1).max(255);
const empty = z.object({}).strict();
const review = z.object({ evaluationRunId: identifier, decision: z.enum(["approved", "rejected", "quarantined"]), reason: z.string().min(1).max(2_000) }).strict();
const promote = z.object({ reviewId: identifier, stableKey: identifier, reason: z.string().min(1).max(2_000) }).strict();
const rollback = z.object({ targetVersionId: identifier, reason: z.string().min(1).max(2_000) }).strict();
const search = z.object({ namespaceId: identifier, query: z.string().min(1).max(10_000), purpose: z.string().min(1).max(255), revision: z.number().int().nonnegative().optional() }).strict();
const candidateApiSchema = candidateInputSchema.omit({ idempotencyKey: true }).strict();

type Route = Readonly<{
  method: string; pattern: RegExp; service: keyof ApiServices; schema?: ZodType;
  idempotent?: boolean; status?: number; parameterNames?: readonly string[];
}>;

const routes: readonly Route[] = [
  { method: "GET", pattern: /^\/v1\/overview$/, service: "getOverview" },
  { method: "GET", pattern: /^\/v1\/agents$/, service: "listAgents" },
  { method: "GET", pattern: /^\/v1\/memory$/, service: "listMemories" },
  { method: "GET", pattern: /^\/v1\/memory\/([^/]+)$/, service: "getMemory", parameterNames: ["memoryId"] },
  { method: "POST", pattern: /^\/v1\/candidates$/, service: "createCandidate", schema: candidateApiSchema, idempotent: true, status: 202 },
  { method: "GET", pattern: /^\/v1\/candidates$/, service: "listCandidates" },
  { method: "GET", pattern: /^\/v1\/candidates\/([^/]+)$/, service: "getCandidate", parameterNames: ["candidateId"] },
  { method: "POST", pattern: /^\/v1\/candidates\/([^/]+)\/screen$/, service: "screenCandidate", schema: empty, idempotent: true, status: 202, parameterNames: ["candidateId"] },
  { method: "POST", pattern: /^\/v1\/candidates\/([^/]+)\/evaluate$/, service: "evaluateCandidate", schema: empty, idempotent: true, status: 202, parameterNames: ["candidateId"] },
  { method: "POST", pattern: /^\/v1\/candidates\/([^/]+)\/reviews$/, service: "reviewCandidate", schema: review, idempotent: true, parameterNames: ["candidateId"] },
  { method: "POST", pattern: /^\/v1\/candidates\/([^/]+)\/promote$/, service: "promoteCandidate", schema: promote, idempotent: true, parameterNames: ["candidateId"] },
  { method: "POST", pattern: /^\/v1\/lineages\/([^/]+)\/rollback$/, service: "rollbackLineage", schema: rollback, idempotent: true, parameterNames: ["lineageId"] },
  { method: "POST", pattern: /^\/v1\/memory\/search$/, service: "searchMemory", schema: search },
  { method: "GET", pattern: /^\/v1\/memory\/([^/]+)\/explain$/, service: "explainMemory", parameterNames: ["memoryId"] },
  { method: "GET", pattern: /^\/v1\/namespaces\/([^/]+)\/revision$/, service: "namespaceRevision", parameterNames: ["namespaceId"] },
  { method: "GET", pattern: /^\/v1\/evaluations$/, service: "listEvaluations" },
  { method: "GET", pattern: /^\/v1\/evaluations\/([^/]+)$/, service: "getEvaluation", parameterNames: ["evaluationRunId"] },
  { method: "GET", pattern: /^\/v1\/audit$/, service: "listAudit" },
  { method: "GET", pattern: /^\/v1\/workspace\/status$/, service: "getWorkspaceStatus" },
];

function contextFromClaims(claims: AuthClaims, requestId: string): ApiContext {
  return { tenantId: claims.tenantId, principalId: claims.subject, requestId, roles: claims.roles };
}

export function createRouter(dependencies: ApiDependencies): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const requestId = request.headers.get("x-request-id") ?? dependencies.requestId();
    try {
      const url = new URL(request.url);
      const route = routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(url.pathname));
      if (!route) return json({ code: "not_found", message: "The requested route was not found.", requestId }, 404, requestId);
      const claims = await dependencies.auth.verify(readBearerToken(request));
      if (!(await dependencies.membership.hasMembership(claims.subject, claims.tenantId))) {
        throw new DomainError("forbidden", "Tenant membership is required.");
      }
      const match = url.pathname.match(route.pattern)!;
      const routeParameters = Object.fromEntries((route.parameterNames ?? []).map((name, index) => [name, match[index + 1]]));
      let body: Record<string, unknown> = {};
      if (route.schema) {
        const parsed = route.schema.safeParse(await parseJson(request));
        if (!parsed.success) throw new DomainError("invalid_input", "Request body failed validation.");
        body = parsed.data as Record<string, unknown>;
      }
      if (route.idempotent) {
        const idempotencyKey = request.headers.get("idempotency-key");
        if (!idempotencyKey) throw new DomainError("invalid_input", "Idempotency-Key header is required.");
        body.idempotencyKey = idempotencyKey;
      }
      const result = await dependencies.services[route.service](contextFromClaims(claims, requestId), {
        ...routeParameters, ...body,
      });
      return json(result, route.status ?? 200, requestId);
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}
