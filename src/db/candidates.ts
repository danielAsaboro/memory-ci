import { DomainError } from "../domain/errors";
import { transitionCandidate, type CandidateEvent } from "../domain/lifecycle";
import type { Candidate, CandidateState, MemoryClass, TrustClass } from "../domain/types";
import type { TenantTransaction } from "./client";

type CandidateRow = {
  id: string; tenant_id: string; namespace_id: string; lineage_id: string | null;
  state: CandidateState; memory_class: MemoryClass; trust_class: TrustClass;
  canonical_payload: Record<string, unknown>; content_digest: string; source_id: string;
  created_by: string; created_at: Date;
};

export type CreateCandidateInput = Readonly<{
  id: string; namespaceId: string; lineageId: string | null; state: CandidateState;
  memoryClass: MemoryClass; trustClass: TrustClass; canonicalPayload: Readonly<Record<string, unknown>>;
  canonicalText: string; contentDigest: string; sourceId: string; createdBy: string;
  embedding: string | null; idempotencyKey: string | null;
}>;

const eventsByTransition: Partial<Record<CandidateState, Partial<Record<CandidateState, CandidateEvent>>>> = {
  proposed: { screening: "begin_screening", quarantined: "quarantine", rejected: "reject" },
  screening: { evaluating: "screening_passed", quarantined: "quarantine", rejected: "reject", failed: "provider_failed" },
  evaluating: { review_required: "evaluation_passed", quarantined: "quarantine", rejected: "reject", failed: "provider_failed" },
  review_required: { approved: "approve", rejected: "reject", quarantined: "quarantine" },
  approved: { active: "activate", rejected: "reject" },
  active: { superseded: "supersede", rolled_back: "roll_back", expired: "expire" },
};

function mapCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id, tenantId: row.tenant_id, namespaceId: row.namespace_id, lineageId: row.lineage_id,
    state: row.state, memoryClass: row.memory_class, trustClass: row.trust_class,
    canonicalPayload: row.canonical_payload, contentDigest: row.content_digest, sourceId: row.source_id,
    createdBy: row.created_by, createdAt: row.created_at,
  };
}

export class CandidateRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async create(input: CreateCandidateInput): Promise<Candidate> {
    const { client, tenantId } = this.transaction;
    if (input.idempotencyKey) {
      const prior = await client.query<CandidateRow>(
        "SELECT * FROM memory_candidates WHERE tenant_id = $1 AND idempotency_key = $2",
        [tenantId, input.idempotencyKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].content_digest !== input.contentDigest) {
          throw new DomainError("conflict", "Idempotency key was already used for different candidate content.");
        }
        return mapCandidate(prior.rows[0]);
      }
    }

    const result = await client.query<CandidateRow>(
      `INSERT INTO memory_candidates
       (tenant_id, id, namespace_id, lineage_id, state, memory_class, trust_class,
        canonical_payload, canonical_text, content_digest, source_id, created_by, embedding, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::VECTOR,$14)
       RETURNING *`,
      [tenantId, input.id, input.namespaceId, input.lineageId, input.state, input.memoryClass,
        input.trustClass, input.canonicalPayload, input.canonicalText, input.contentDigest,
        input.sourceId, input.createdBy, input.embedding, input.idempotencyKey],
    );
    return mapCandidate(result.rows[0]!);
  }

  async get(id: string): Promise<Candidate | null> {
    const result = await this.transaction.client.query<CandidateRow>(
      "SELECT * FROM memory_candidates WHERE tenant_id = $1 AND id = $2",
      [this.transaction.tenantId, id],
    );
    return result.rows[0] ? mapCandidate(result.rows[0]) : null;
  }

  async list(namespaceId?: string): Promise<Candidate[]> {
    const result = await this.transaction.client.query<CandidateRow>(
      `SELECT * FROM memory_candidates
       WHERE tenant_id = $1 AND ($2::UUID IS NULL OR namespace_id = $2)
       ORDER BY created_at DESC, id DESC`,
      [this.transaction.tenantId, namespaceId ?? null],
    );
    return result.rows.map(mapCandidate);
  }

  async transition(id: string, nextState: CandidateState): Promise<Candidate> {
    const current = await this.get(id);
    if (!current) throw new DomainError("not_found", "Candidate was not found.");
    const event = eventsByTransition[current.state]?.[nextState];
    if (!event) throw new DomainError("invalid_transition", `Cannot move candidate from ${current.state} to ${nextState}.`);
    transitionCandidate(current.state, event);

    const result = await this.transaction.client.query<CandidateRow>(
      `UPDATE memory_candidates SET state = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND state = $4 RETURNING *`,
      [this.transaction.tenantId, id, nextState, current.state],
    );
    if (!result.rows[0]) throw new DomainError("conflict", "Candidate state changed concurrently.");
    return mapCandidate(result.rows[0]);
  }
}
