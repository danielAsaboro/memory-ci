export type DomainErrorCode =
  | "invalid_transition"
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "stale_review"
  | "provider_unavailable"
  | "inconclusive";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly safeDetails?: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, safeDetails?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.safeDetails = safeDetails;
  }
}
