import { DomainError } from "../domain/errors";

const statusByCode: Record<string, number> = {
  invalid_input: 400, unauthorized: 401, forbidden: 403, not_found: 404,
  conflict: 409, stale_review: 409, inconclusive: 422, provider_unavailable: 503,
};

const safeMessageByCode: Record<string, string> = {
  invalid_input: "The request is invalid.", unauthorized: "Authentication is required.",
  forbidden: "You do not have access to this resource.", not_found: "The requested resource was not found.",
  conflict: "The request conflicts with current state.", stale_review: "The approval is stale and must be repeated.",
  inconclusive: "The operation was inconclusive.", provider_unavailable: "A required provider is unavailable.",
};

export function json(body: unknown, status = 200, requestId?: string): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (requestId) headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(error: unknown, requestId: string): Response {
  const code = error instanceof DomainError ? error.code :
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "internal_error";
  const status = statusByCode[code] ?? 500;
  const message = safeMessageByCode[code] ?? "The request could not be completed.";
  return json({ code, message, requestId }, status, requestId);
}

export async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new DomainError("invalid_input", "Request body must be valid JSON.");
  }
}
