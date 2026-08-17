import { z } from "zod";

import { memoryClasses, trustClasses } from "../domain/types";

const sourceTypes = ["message", "document", "tool", "api", "operator", "system"] as const;

export const candidateInputSchema = z.object({
  namespaceId: z.string().uuid(),
  memoryClass: z.enum(memoryClasses),
  trustClass: z.enum(trustClasses),
  canonicalText: z.string().min(1).max(65_536),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1).max(255),
  embedding: z.string().nullable().optional(),
  source: z.object({
    id: z.string().uuid(),
    sourceType: z.enum(sourceTypes),
    content: z.string().min(1).max(1_000_000),
    contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceUri: z.string().url().optional(),
    signatureIdentity: z.string().max(500).optional(),
    signatureKeyId: z.string().max(500).optional(),
    signatureAlgorithm: z.literal("ed25519").optional(),
    signature: z.string().min(1).max(16_384).optional(),
    validUntil: z.coerce.date().optional(),
  }),
});

export type CandidateInput = z.infer<typeof candidateInputSchema>;

export function hasElevatedProvenanceFields(input: Pick<CandidateInput, "trustClass" | "source">): boolean {
  return (input.trustClass !== "authenticated" && input.trustClass !== "authoritative") || Boolean(
    input.source.signatureIdentity && input.source.signatureKeyId && input.source.signatureAlgorithm === "ed25519" && input.source.signature,
  );
}
