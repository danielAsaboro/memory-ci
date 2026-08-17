import { z, type ZodType } from "zod";

import { integrationsSchema } from "../../src/contracts/dashboard";

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

export async function stashQuery<T>(path: string, schema: ZodType<T>): Promise<T> {
  return request(path, { method: "GET", cache: "no-store" }, schema);
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

async function request<T>(path: string, init: RequestInit, schema: ZodType<T>): Promise<T> {
  const response = await fetch(gatewayPath(path), init);
  const body = await response.text();
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
