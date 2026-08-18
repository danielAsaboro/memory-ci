import { z, type ZodType } from "zod";

import {
  agentSchema, auditEventSchema, candidateSummarySchema, evaluationDetailSchema, evaluationSummarySchema,
  integrationsSchema, memoryDetailSchema, memorySummarySchema, memoryRetrievalReceiptSchema, overviewSchema, workspaceStatusSchema,
  candidateReceiptSchema, evaluationRequestSchema, memoryMutationReceiptSchema, reviewReceiptSchema, screeningReceiptSchema,
  type Agent, type AuditEvent, type CandidateSummary, type EvaluationDetail, type EvaluationSummary,
  type MemoryDetail, type MemorySummary, type MemoryRetrievalReceipt, type Overview, type WorkspaceStatus, type CandidateReceipt, type EvaluationRequest,
  type MemoryMutationReceipt, type ReviewReceipt, type ScreeningReceipt,
} from "../../src/contracts/dashboard";

export type IntegrationState = "ready" | "pending" | "blocked" | "unavailable" | "loading";
export type IntegrationStatus = Record<"cockroach" | "aws" | "agent", { state: IntegrationState; detail: string }>;

const gatewayErrorSchema = z.object({
  code: z.string().min(1), message: z.string().min(1), requestId: z.string().min(1),
}).strict();

export class StashApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly status: number;

  constructor({ code, message, requestId, status }: { code: string; message: string; requestId: string; status: number }) {
    super(message);
    this.name = "StashApiError";
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

export async function stashQuery<T>(path: string, schema: ZodType<T>, signal?: AbortSignal): Promise<T> {
  return request(path, signal ? { method: "GET", cache: "no-store", signal } : { method: "GET", cache: "no-store" }, schema);
}

export async function stashMutation<TInput, TOutput>(
  path: string,
  input: TInput,
  schema: ZodType<TOutput>,
  idempotencyKey = crypto.randomUUID(),
): Promise<TOutput> {
  return request(path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(input),
  }, schema);
}

export async function getIntegrationStatus(): Promise<{ demoMode: boolean; status: IntegrationStatus }> {
  const workspace = await stashQuery("/v1/workspace/status", z.object({ integrations: integrationsSchema }).strict());
  return { demoMode: false, status: workspace.integrations };
}

export const queryKeys = {
  overview: (workspaceId: string) => ["workspace", workspaceId, "overview"] as const,
  candidates: (workspaceId: string) => ["workspace", workspaceId, "candidates"] as const,
  candidate: (workspaceId: string, candidateId: string) => ["workspace", workspaceId, "candidate", candidateId] as const,
  memories: (workspaceId: string) => ["workspace", workspaceId, "memories"] as const,
  memory: (workspaceId: string, memoryId: string) => ["workspace", workspaceId, "memory", memoryId] as const,
  evaluations: (workspaceId: string) => ["workspace", workspaceId, "evaluations"] as const,
  evaluation: (workspaceId: string, evaluationId: string) => ["workspace", workspaceId, "evaluation", evaluationId] as const,
  namespaceEvidence: (workspaceId: string, namespaceId: string) => ["workspace", workspaceId, "namespace", namespaceId, "evidence"] as const,
  agents: (workspaceId: string) => ["workspace", workspaceId, "agents"] as const,
  audit: (workspaceId: string) => ["workspace", workspaceId, "audit"] as const,
  status: (workspaceId: string) => ["workspace", workspaceId, "status"] as const,
};

export const getOverview = (): Promise<Overview> => stashQuery("/v1/overview", overviewSchema);
export const getCandidates = (): Promise<CandidateSummary[]> => stashQuery("/v1/candidates", candidateSummarySchema.array());
export const getCandidate = (id: string): Promise<CandidateSummary> => stashQuery(`/v1/candidates/${id}`, candidateSummarySchema);
export const getMemories = (): Promise<MemorySummary[]> => stashQuery("/v1/memory", memorySummarySchema.array());
export const getMemory = (id: string): Promise<MemoryDetail> => stashQuery(`/v1/memory/${id}`, memoryDetailSchema);
export const searchMemory = (input: { namespaceId: string; agentId: string; query: string; purpose: string }): Promise<MemoryRetrievalReceipt> => stashMutation("/v1/memory/search", input, memoryRetrievalReceiptSchema);
export const getEvaluations = (signal?: AbortSignal): Promise<EvaluationSummary[]> => stashQuery("/v1/evaluations", evaluationSummarySchema.array(), signal);
export const getEvaluation = (id: string, signal?: AbortSignal): Promise<EvaluationDetail> => stashQuery(`/v1/evaluations/${id}`, evaluationDetailSchema, signal);
export const getAgents = (): Promise<Agent[]> => stashQuery("/v1/agents", agentSchema.array());
export const getAuditEvents = (): Promise<AuditEvent[]> => stashQuery("/v1/audit", auditEventSchema.array());
export const getWorkspaceStatus = (): Promise<WorkspaceStatus> => stashQuery("/v1/workspace/status", workspaceStatusSchema);
export const createCandidate = (input: unknown, key: string): Promise<CandidateReceipt> => stashMutation("/v1/candidates", input, candidateReceiptSchema, key);
export const screenCandidate = (id: string, key: string): Promise<ScreeningReceipt> => stashMutation(`/v1/candidates/${id}/screen`, {}, screeningReceiptSchema, key);
export const requestEvaluation = (id: string, key: string): Promise<EvaluationRequest> => stashMutation(`/v1/candidates/${id}/evaluate`, {}, evaluationRequestSchema, key);
export const submitReview = (id: string, input: { evaluationRunId: string; decision: "approved" | "rejected" | "quarantined"; reason: string }, key: string): Promise<ReviewReceipt> => stashMutation(`/v1/candidates/${id}/reviews`, input, reviewReceiptSchema, key);
export const promoteCandidate = (id: string, input: { reviewId: string; stableKey: string; reason: string }, key: string): Promise<MemoryMutationReceipt> => stashMutation(`/v1/candidates/${id}/promote`, input, memoryMutationReceiptSchema, key);
export const rollbackLineage = (id: string, input: { targetVersionId: string; reason: string }, key: string): Promise<MemoryMutationReceipt> => stashMutation(`/v1/lineages/${id}/rollback`, input, memoryMutationReceiptSchema, key);

async function request<T>(path: string, init: RequestInit, schema: ZodType<T>): Promise<T> {
  let response: Response;
  let body: string;
  try {
    response = await fetch(gatewayPath(path), init);
    body = await response.text();
  } catch {
    throw new StashApiError({
      code: "transport_error",
      message: "The Stash request could not be completed.",
      requestId: "unknown",
      status: 0,
    });
  }
  if (!response.ok) throw parseError(response, body);
  const result = schema.safeParse(parseJson(body));
  if (!result.success) {
    throw new StashApiError({
      code: "invalid_response",
      message: "Stash returned an invalid response.",
      requestId: response.headers.get("x-request-id") ?? "unknown",
      status: response.status,
    });
  }
  return result.data;
}

function gatewayPath(path: string): string {
  if (!path.startsWith("/v1/") || path.includes("://") || path.includes("..")) {
    throw new StashApiError({ code: "invalid_path", message: "Invalid Stash API path.", requestId: "local", status: 400 });
  }
  return `/api/stash${path}`;
}

function parseError(response: Response, body: string): StashApiError {
  const parsed = gatewayErrorSchema.safeParse(parseJson(body));
  if (parsed.success) return new StashApiError({ ...parsed.data, status: response.status });
  return new StashApiError({
    code: "request_failed",
    message: "The Stash request could not be completed.",
    requestId: response.headers.get("x-request-id") ?? "unknown",
    status: response.status,
  });
}

function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
