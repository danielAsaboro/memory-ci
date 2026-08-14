import { createHash } from "node:crypto";

import { DomainError } from "../domain/errors";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyProvenanceDigest(content: string, claimedDigest: string): true {
  const actualDigest = sha256(content);
  if (actualDigest !== claimedDigest) {
    throw new DomainError("invalid_input", "Source content does not match its provenance digest.", {
      claimedDigest,
      actualDigest,
    });
  }
  return true;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}
