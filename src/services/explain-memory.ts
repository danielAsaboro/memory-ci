import type { TenantTransaction } from "../db/client";
import { DomainError } from "../domain/errors";

export type MemoryExplanation = Readonly<{
  memoryVersionId: string;
  contentDigest: string;
  provenance: Readonly<{ sourceType: string; sourceUri: string | null; trustClass: string; signatureIdentity: string | null; signatureVerified: boolean }>;
  review: Readonly<{ decision: string; reason: string; reviewerId: string }> | null;
  evaluation: Readonly<{ status: string; modelId: string | null; providerRequestId: string | null; policyVersion: string }> | null;
  activation: Readonly<{ eventType: string; revision: number; reason: string }> | null;
  relations: readonly Readonly<{ relationType: string; confidence: number; evidence: Readonly<Record<string, unknown>> }>[];
}>;

export async function explainMemory(transaction: TenantTransaction, memoryVersionId: string): Promise<MemoryExplanation> {
  const result = await transaction.client.query<{
    id: string; content_digest: string; source_type: string; source_uri: string | null; trust_class: string;
    signature_identity: string | null; signature_verified: boolean; review_decision: string | null;
    review_reason: string | null; reviewer_id: string | null; evaluation_status: string | null;
    model_id: string | null; provider_request_id: string | null; policy_version: string | null;
    event_type: string | null; activation_revision: string | null; activation_reason: string | null;
  }>(
    `SELECT v.id,v.content_digest,s.source_type,s.source_uri,s.trust_class,s.signature_identity,s.signature_verified,
            r.decision AS review_decision,r.reason AS review_reason,r.reviewer_id,
            e.status AS evaluation_status,e.model_id,e.provider_request_id,e.policy_version,
            a.event_type,a.revision AS activation_revision,a.reason AS activation_reason
     FROM memory_versions v
     JOIN memory_candidates c ON c.tenant_id=v.tenant_id AND c.id=v.candidate_id
     JOIN sources s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
     LEFT JOIN reviews r ON r.tenant_id=c.tenant_id AND r.candidate_id=c.id AND r.decision='approved'
     LEFT JOIN evaluation_runs e ON e.tenant_id=r.tenant_id AND e.id=r.evaluation_run_id
     LEFT JOIN activation_events a ON a.tenant_id=v.tenant_id AND a.memory_version_id=v.id
     WHERE v.tenant_id=$1 AND v.id=$2
     ORDER BY r.created_at DESC,a.created_at DESC LIMIT 1`,
    [transaction.tenantId, memoryVersionId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("not_found", "Memory version was not found.");
  const relations = await transaction.client.query<{
    relation_type: string; confidence: string; evidence: Record<string, unknown>;
  }>(
    `SELECT relation_type,confidence,evidence FROM memory_relations
     WHERE tenant_id=$1 AND to_memory_version_id=$2 ORDER BY confidence DESC`,
    [transaction.tenantId, memoryVersionId],
  );
  return {
    memoryVersionId: row.id, contentDigest: row.content_digest,
    provenance: {
      sourceType: row.source_type, sourceUri: row.source_uri, trustClass: row.trust_class,
      signatureIdentity: row.signature_identity, signatureVerified: row.signature_verified,
    },
    review: row.review_decision ? { decision: row.review_decision, reason: row.review_reason!, reviewerId: row.reviewer_id! } : null,
    evaluation: row.evaluation_status ? {
      status: row.evaluation_status, modelId: row.model_id, providerRequestId: row.provider_request_id,
      policyVersion: row.policy_version!,
    } : null,
    activation: row.event_type ? {
      eventType: row.event_type, revision: Number(row.activation_revision), reason: row.activation_reason!,
    } : null,
    relations: relations.rows.map((relation) => ({
      relationType: relation.relation_type, confidence: Number(relation.confidence), evidence: relation.evidence,
    })),
  };
}
