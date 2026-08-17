import type { Candidate, TenantContext } from "../domain/types";
import type { CreateCandidateInput } from "../db/candidates";
import { DomainError } from "../domain/errors";
import { candidateInputSchema, type CandidateInput } from "../contracts/candidate";
import { canonicalJson, sha256, verifyProvenanceDigest } from "./provenance";
import { redactCandidatePayload } from "./redaction";
import { keyFingerprint, type TrustedSourceKeyRegistry, verifyTrustedSourceSignature } from "./source-signature";

type SourceInput = Readonly<{
  id: string; tenantId: string; sourceType: CandidateInput["source"]["sourceType"];
  sourceUri: string | null; trustClass: CandidateInput["trustClass"]; contentDigest: string;
  signatureIdentity: string | null; signatureKeyId: string | null; signatureKeyFingerprint: string | null;
  signatureAlgorithm: string | null; signature: string | null; canonicalSignedPayload: string | null;
  signaturePayloadVersion: number | null; signatureVerified: boolean; validUntil: Date | null; submittedBy: string;
}>;

export type IngestionDependencies = Readonly<{
  namespaces: { get(id: string): Promise<{ protected: boolean } | null> };
  sources: { upsert(input: SourceInput): Promise<{ id: string }> };
  candidates: { create(input: CreateCandidateInput): Promise<Candidate> };
  audit: { append(input: Record<string, unknown>): Promise<unknown> };
  outbox: { enqueue(input: { eventType: string; aggregateType: string; aggregateId: string; payload: Readonly<Record<string, unknown>> }): Promise<unknown> };
  embeddings: { embed(text: string): Promise<string> };
  trustedSourceKeys: TrustedSourceKeyRegistry;
  authorizeProtectedNamespace(context: TenantContext, namespaceId: string): Promise<boolean>;
  id(): string;
}>;

export type CandidateReceipt = Readonly<{
  id: string; state: Candidate["state"]; contentDigest: string; provenanceVerified: boolean;
  redactions: readonly string[];
}>;

export async function ingestCandidate(
  context: TenantContext,
  rawInput: CandidateInput,
  dependencies: IngestionDependencies,
): Promise<CandidateReceipt> {
  const parsed = candidateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError("invalid_input", "Candidate input is invalid.", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
  }
  const input = parsed.data;
  const namespace = await dependencies.namespaces.get(input.namespaceId);
  if (!namespace) throw new DomainError("not_found", "Memory namespace was not found.");
  if (namespace.protected && !(await dependencies.authorizeProtectedNamespace(context, input.namespaceId))) {
    throw new DomainError("forbidden", "Protected memory namespaces require explicit authorization.");
  }

  verifyProvenanceDigest(input.source.content, input.source.contentDigest);
  if (input.source.validUntil && input.source.validUntil.getTime() <= Date.now()) {
    throw new DomainError("invalid_input", "Source provenance has expired.");
  }
  const redacted = redactCandidatePayload({ payload: input.payload, canonicalText: input.canonicalText });
  const canonical = canonicalJson({ text: redacted.canonicalText, payload: redacted.payload });
  if (Buffer.byteLength(canonical, "utf8") > 65_536) {
    throw new DomainError("invalid_input", "Canonical candidate content exceeds 64 KiB.");
  }
  const contentDigest = sha256(canonical);

  const signature = verifyTrustedSourceSignature(input.source, dependencies.trustedSourceKeys);
  const signatureVerified = signature.verified;
  const trustClass = input.trustClass === "authenticated" && !signatureVerified ? "observed" : input.trustClass;
  await dependencies.sources.upsert({
    id: input.source.id, tenantId: context.tenantId, sourceType: input.source.sourceType,
    sourceUri: input.source.sourceUri ?? null, trustClass,
    contentDigest: input.source.contentDigest, signatureIdentity: input.source.signatureIdentity ?? null,
    signatureKeyId: input.source.signatureKeyId ?? null, signatureKeyFingerprint: signature.key ? keyFingerprint(signature.key.publicKey) : null,
    signatureAlgorithm: input.source.signatureAlgorithm ?? null, signature: input.source.signature ?? null,
    canonicalSignedPayload: signature.canonicalPayload, signaturePayloadVersion: signature.canonicalPayload ? 1 : null,
    signatureVerified, validUntil: input.source.validUntil ?? null,
    submittedBy: context.principalId,
  });
  const candidate = await dependencies.candidates.create({
    id: dependencies.id(), namespaceId: input.namespaceId, lineageId: null, state: "proposed",
    memoryClass: input.memoryClass, trustClass,
    canonicalPayload: redacted.payload, canonicalText: redacted.canonicalText, contentDigest,
    sourceId: input.source.id, createdBy: context.principalId, embedding: await dependencies.embeddings.embed(redacted.canonicalText),
    idempotencyKey: input.idempotencyKey,
  });
  await dependencies.audit.append({
    actorId: context.principalId, action: "candidate.proposed", resourceType: "memory_candidate",
    resourceId: candidate.id, requestId: context.requestId,
    safeDetails: { namespaceId: input.namespaceId, contentDigest, redactions: redacted.redactions },
  });
  await dependencies.outbox.enqueue({
    eventType: "candidate.proposed", aggregateType: "memory_candidate", aggregateId: candidate.id,
    payload: { tenantId: context.tenantId, namespaceId: input.namespaceId, contentDigest },
  });
  return { id: candidate.id, state: candidate.state, contentDigest, provenanceVerified: signatureVerified, redactions: redacted.redactions };
}
