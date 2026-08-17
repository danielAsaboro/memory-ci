import type { Pool } from "pg";

import type {
  Agent, AuditEvent, CandidateSummary, EvaluationDetail, EvaluationSummary, MemoryDetail, MemorySummary,
  Overview, WorkspaceStatus,
} from "../contracts/dashboard";
import {
  agentSchema, auditEventSchema, candidateSummarySchema, evaluationDetailSchema, evaluationSummarySchema,
  memoryDetailSchema, memorySummarySchema, overviewSchema, workspaceStatusSchema,
} from "../contracts/dashboard";
import type { ApiContext } from "../api/router";
import { withTenantTransaction, type TenantTransaction } from "../db/client";
import { DomainError } from "../domain/errors";

type ReadInput = Record<string, unknown>;
type ReadService<T> = (context: ApiContext, input: ReadInput) => Promise<T>;

export type ReadWorkspaceServices = Readonly<{
  getOverview: ReadService<Overview>;
  listAgents: ReadService<Agent[]>;
  listMemories: ReadService<MemorySummary[]>;
  getMemory: ReadService<MemoryDetail>;
  listEvaluations: ReadService<EvaluationSummary[]>;
  getEvaluation: ReadService<EvaluationDetail>;
  listCandidates: ReadService<CandidateSummary[]>;
  getCandidate: ReadService<CandidateSummary>;
  listAudit: ReadService<AuditEvent[]>;
  getWorkspaceStatus: ReadService<WorkspaceStatus>;
}>;

const asIdentifier = (input: ReadInput, key: string): string => {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new DomainError("invalid_input", `${key} is required.`);
  return value;
};

const asNumber = (value: string | number): number => Number(value);
const asTimestamp = (value: Date | string): string => new Date(value).toISOString();
const asNullableTimestamp = (value: Date | string | null): string | null => value ? asTimestamp(value) : null;

type MemoryRow = {
  id: string; namespace_id: string; namespace_name: string; lineage_id: string; stable_key: string; candidate_id: string;
  memory_class: MemorySummary["memoryClass"]; canonical_text: string; content_digest: string; version: string; revision: string;
  active: boolean; reads: string; valid_from: Date; valid_until: Date | null;
};

const mapMemory = (row: MemoryRow): MemorySummary => memorySummarySchema.parse({
  id: row.id, namespaceId: row.namespace_id, namespaceName: row.namespace_name, lineageId: row.lineage_id,
  stableKey: row.stable_key, candidateId: row.candidate_id, memoryClass: row.memory_class,
  canonicalText: row.canonical_text, contentDigest: row.content_digest, version: asNumber(row.version),
  revision: asNumber(row.revision), active: row.active, reads: asNumber(row.reads),
  validFrom: asTimestamp(row.valid_from), validUntil: asNullableTimestamp(row.valid_until),
});

async function listMemoryRows(transaction: TenantTransaction, memoryId?: string, lineageId?: string): Promise<MemorySummary[]> {
  const result = await transaction.client.query<MemoryRow>(
    `SELECT v.id,v.namespace_id,n.name AS namespace_name,v.lineage_id,l.stable_key,v.candidate_id,v.memory_class,
            v.canonical_text,v.content_digest,v.version,v.revision,v.active,v.valid_from,v.valid_until,
            (SELECT count(*) FROM memory_reads r
             WHERE r.tenant_id=v.tenant_id AND v.id = ANY(r.returned_version_ids)) AS reads
     FROM memory_versions v
     JOIN agent_namespaces n ON n.tenant_id=v.tenant_id AND n.id=v.namespace_id
     JOIN memory_lineages l ON l.tenant_id=v.tenant_id AND l.id=v.lineage_id
     WHERE v.tenant_id=$1 AND ($2::UUID IS NULL OR v.id=$2) AND ($3::UUID IS NULL OR v.lineage_id=$3)
     ORDER BY v.active DESC,v.created_at DESC,v.id DESC`,
    [transaction.tenantId, memoryId ?? null, lineageId ?? null],
  );
  return result.rows.map(mapMemory);
}

type CandidateRow = {
  id: string; namespace_id: string; namespace_name: string; lineage_id: string | null;
  state: CandidateSummary["state"]; memory_class: CandidateSummary["memoryClass"]; trust_class: CandidateSummary["trustClass"];
  canonical_text: string; content_digest: string; source_id: string; source_uri: string | null; signature_verified: boolean;
  author_id: string; author_name: string; finding_count: string; blocking_finding_count: string; created_at: Date; updated_at: Date;
};

const candidateSelect = `SELECT c.id,c.namespace_id,n.name AS namespace_name,c.lineage_id,c.state,c.memory_class,c.trust_class,
                                 c.canonical_text,c.content_digest,s.id AS source_id,s.source_uri,s.signature_verified,
                                 p.id AS author_id,p.display_name AS author_name,count(f.id) AS finding_count,
                                 count(f.id) FILTER (WHERE f.severity IN ('high','critical')) AS blocking_finding_count,
                                 c.created_at,c.updated_at
                          FROM memory_candidates c
                          JOIN agent_namespaces n ON n.tenant_id=c.tenant_id AND n.id=c.namespace_id
                          JOIN sources s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
                          JOIN principals p ON p.tenant_id=c.tenant_id AND p.id=c.created_by
                          LEFT JOIN screening_findings f ON f.tenant_id=c.tenant_id AND f.candidate_id=c.id`;

const mapCandidate = (row: CandidateRow): CandidateSummary => candidateSummarySchema.parse({
  id: row.id, namespaceId: row.namespace_id, namespaceName: row.namespace_name, lineageId: row.lineage_id,
  state: row.state, memoryClass: row.memory_class, trustClass: row.trust_class, canonicalText: row.canonical_text,
  contentDigest: row.content_digest, source: { id: row.source_id, uri: row.source_uri, signatureVerified: row.signature_verified },
  author: { id: row.author_id, name: row.author_name }, findingCount: asNumber(row.finding_count),
  blockingFindingCount: asNumber(row.blocking_finding_count), createdAt: asTimestamp(row.created_at), updatedAt: asTimestamp(row.updated_at),
});

async function listCandidateRows(transaction: TenantTransaction, candidateId?: string): Promise<CandidateSummary[]> {
  const result = await transaction.client.query<CandidateRow>(
    `${candidateSelect}
     WHERE c.tenant_id=$1 AND ($2::UUID IS NULL OR c.id=$2)
     GROUP BY c.id,c.namespace_id,n.name,c.lineage_id,c.state,c.memory_class,c.trust_class,c.canonical_text,c.content_digest,
              s.id,s.source_uri,s.signature_verified,p.id,p.display_name,c.created_at,c.updated_at
     ORDER BY c.created_at DESC,c.id DESC`,
    [transaction.tenantId, candidateId ?? null],
  );
  return result.rows.map(mapCandidate);
}

type EvaluationRow = {
  id: string; candidate_id: string; baseline_revision: string; policy_version: string;
  status: EvaluationSummary["status"]; model_id: string | null; provider_request_id: string | null;
  started_at: Date | null; completed_at: Date | null; result_count: string;
};

const evaluationSelect = `SELECT e.id,e.candidate_id,e.baseline_revision,e.policy_version,e.status,e.model_id,e.provider_request_id,
                                  e.started_at,e.completed_at,count(r.id) AS result_count
                           FROM evaluation_runs e
                           LEFT JOIN evaluation_results r ON r.tenant_id=e.tenant_id AND r.evaluation_run_id=e.id`;

const mapEvaluation = (row: EvaluationRow): EvaluationSummary => evaluationSummarySchema.parse({
  id: row.id, candidateId: row.candidate_id, baselineRevision: asNumber(row.baseline_revision), policyVersion: row.policy_version,
  status: row.status, modelId: row.model_id, providerRequestId: row.provider_request_id,
  startedAt: asNullableTimestamp(row.started_at), completedAt: asNullableTimestamp(row.completed_at), resultCount: asNumber(row.result_count),
});

async function listEvaluationRows(transaction: TenantTransaction, evaluationRunId?: string): Promise<EvaluationSummary[]> {
  const result = await transaction.client.query<EvaluationRow>(
    `${evaluationSelect}
     WHERE e.tenant_id=$1 AND ($2::UUID IS NULL OR e.id=$2)
     GROUP BY e.id,e.candidate_id,e.baseline_revision,e.policy_version,e.status,e.model_id,e.provider_request_id,e.started_at,e.completed_at,e.created_at
     ORDER BY coalesce(e.completed_at,e.started_at,e.created_at) DESC,e.id DESC`,
    [transaction.tenantId, evaluationRunId ?? null],
  );
  return result.rows.map(mapEvaluation);
}

async function databaseIntegration(pool: Pool) {
  try {
    const index = await pool.query<{ index_name: string }>(
      "SELECT index_name FROM [SHOW INDEX FROM memory_versions] WHERE index_name=$1",
      ["memory_versions_embedding_idx"],
    );
    return index.rows[0]
      ? { state: "ready" as const, detail: "CockroachDB reachable; memory vector index available." }
      : { state: "pending" as const, detail: "CockroachDB reachable; memory vector index is not available." };
  } catch {
    return { state: "unavailable" as const, detail: "CockroachDB health query failed." };
  }
}

function awsIntegration() {
  const configured = ["BEDROCK_MODEL_ID", "EVIDENCE_BUCKET", "EVENT_BUS_NAME"].filter((name) => Boolean(process.env[name]));
  return configured.length === 3
    ? { state: "ready" as const, detail: "Bedrock, evidence storage, and event delivery are configured." }
    : { state: "blocked" as const, detail: `AWS configuration incomplete (${configured.length}/3 providers configured).` };
}

export function createReadWorkspaceServices(pool: Pool): ReadWorkspaceServices {
  const run = <T>(context: ApiContext, operation: (transaction: TenantTransaction) => Promise<T>) =>
    withTenantTransaction(pool, context.tenantId, operation);

  return {
    getOverview: (context) => run(context, async (transaction) => {
      const result = await transaction.client.query<{
        id: string; name: string; agents: string; active_memories: string; candidates: string; evaluations: string; audit_events: string;
      }>(
        `SELECT t.id,t.name,
                (SELECT count(*) FROM principals p WHERE p.tenant_id=t.id AND p.kind='agent') AS agents,
                (SELECT count(*) FROM memory_versions v WHERE v.tenant_id=t.id AND v.active) AS active_memories,
                (SELECT count(*) FROM memory_candidates c WHERE c.tenant_id=t.id) AS candidates,
                (SELECT count(*) FROM evaluation_runs e WHERE e.tenant_id=t.id) AS evaluations,
                (SELECT count(*) FROM audit_events a WHERE a.tenant_id=t.id) AS audit_events
         FROM tenants t WHERE t.id=$1`,
        [transaction.tenantId],
      );
      const row = result.rows[0];
      if (!row) throw new DomainError("not_found", "Workspace was not found.");
      return overviewSchema.parse({
        workspace: { id: row.id, name: row.name },
        metrics: { agents: asNumber(row.agents), activeMemories: asNumber(row.active_memories), candidates: asNumber(row.candidates),
          evaluations: asNumber(row.evaluations), auditEvents: asNumber(row.audit_events) },
      });
    }),
    listAgents: (context) => run(context, async (transaction) => {
      const result = await transaction.client.query<{
        id: string; name: string; namespace_ids: string[]; reads: string; last_read_at: Date | null;
      }>(
        `SELECT p.id,p.display_name AS name,
                ARRAY(SELECT n.id::STRING FROM agent_namespaces n WHERE n.tenant_id=p.tenant_id ORDER BY n.id) AS namespace_ids,
                (SELECT count(*) FROM memory_reads r WHERE r.tenant_id=p.tenant_id AND r.principal_id=p.id) AS reads,
                (SELECT max(r.created_at) FROM memory_reads r WHERE r.tenant_id=p.tenant_id AND r.principal_id=p.id) AS last_read_at
         FROM principals p WHERE p.tenant_id=$1 AND p.kind='agent' ORDER BY p.display_name,p.id`,
        [transaction.tenantId],
      );
      return result.rows.map((row) => agentSchema.parse({
        id: row.id, name: row.name, namespaceIds: row.namespace_ids, reads: asNumber(row.reads), lastReadAt: asNullableTimestamp(row.last_read_at),
      }));
    }),
    listMemories: (context) => run(context, (transaction) => listMemoryRows(transaction)),
    getMemory: (context, input) => run(context, async (transaction) => {
      const memory = (await listMemoryRows(transaction, asIdentifier(input, "memoryId")))[0];
      if (!memory) throw new DomainError("not_found", "Memory was not found.");
      const lineage = await listMemoryRows(transaction, undefined, memory.lineageId);
      return memoryDetailSchema.parse({ ...memory, lineage });
    }),
    listEvaluations: (context) => run(context, (transaction) => listEvaluationRows(transaction)),
    getEvaluation: (context, input) => run(context, async (transaction) => {
      const evaluation = (await listEvaluationRows(transaction, asIdentifier(input, "evaluationRunId")))[0];
      if (!evaluation) throw new DomainError("not_found", "Evaluation was not found.");
      const results = await transaction.client.query<{
        id: string; scenario_id: string; scenario_name: string; status: "passed" | "regressed" | "inconclusive" | "failed";
        artifact_uri: string | null; provider_request_id: string | null; created_at: Date;
      }>(
        `SELECT r.id,r.scenario_id,s.name AS scenario_name,r.status,r.artifact_uri,r.provider_request_id,r.created_at
         FROM evaluation_results r
         JOIN evaluation_scenarios s ON s.tenant_id=r.tenant_id AND s.id=r.scenario_id
         WHERE r.tenant_id=$1 AND r.evaluation_run_id=$2 ORDER BY r.created_at,r.id`,
        [transaction.tenantId, evaluation.id],
      );
      return evaluationDetailSchema.parse({
        ...evaluation,
        results: results.rows.map((row) => ({
          id: row.id, scenarioId: row.scenario_id, scenarioName: row.scenario_name, status: row.status,
          artifactUri: row.artifact_uri, providerRequestId: row.provider_request_id, createdAt: asTimestamp(row.created_at),
        })),
      });
    }),
    listCandidates: (context) => run(context, (transaction) => listCandidateRows(transaction)),
    getCandidate: (context, input) => run(context, async (transaction) => {
      const candidate = (await listCandidateRows(transaction, asIdentifier(input, "candidateId")))[0];
      if (!candidate) throw new DomainError("not_found", "Candidate was not found.");
      return candidate;
    }),
    listAudit: (context) => run(context, async (transaction) => {
      const result = await transaction.client.query<{
        id: string; actor_id: string; actor_name: string; action: string; resource_type: string; resource_id: string; request_id: string;
        provider_request_id: string | null; event_digest: string; previous_event_digest: string | null; created_at: Date;
      }>(
        `SELECT a.id,p.id AS actor_id,p.display_name AS actor_name,a.action,a.resource_type,a.resource_id,a.request_id,
                a.provider_request_id,a.event_digest,a.previous_event_digest,a.created_at
         FROM audit_events a
         JOIN principals p ON p.tenant_id=a.tenant_id AND p.id=a.actor_id
         WHERE a.tenant_id=$1 ORDER BY a.created_at,a.id LIMIT 100`,
        [transaction.tenantId],
      );
      return result.rows.map((row) => auditEventSchema.parse({
        id: row.id, actor: { id: row.actor_id, name: row.actor_name }, action: row.action,
        resource: { type: row.resource_type, id: row.resource_id }, requestId: row.request_id,
        providerRequestId: row.provider_request_id, eventDigest: row.event_digest, previousEventDigest: row.previous_event_digest,
        createdAt: asTimestamp(row.created_at),
      }));
    }),
    getWorkspaceStatus: async (context) => {
      const cockroach = await databaseIntegration(pool);
      return run(context, async (transaction) => {
        const result = await transaction.client.query<{ id: string; name: string; namespace_count: string; agent_count: string }>(
          `SELECT t.id,t.name,
                  (SELECT count(*) FROM agent_namespaces n WHERE n.tenant_id=t.id) AS namespace_count,
                  (SELECT count(*) FROM principals p WHERE p.tenant_id=t.id AND p.kind='agent') AS agent_count
           FROM tenants t WHERE t.id=$1`,
          [transaction.tenantId],
        );
        const row = result.rows[0];
        if (!row) throw new DomainError("not_found", "Workspace was not found.");
        const agentCount = asNumber(row.agent_count);
        return workspaceStatusSchema.parse({
          workspace: { id: row.id, name: row.name }, namespaceCount: asNumber(row.namespace_count),
          integrations: {
            cockroach,
            aws: awsIntegration(),
            agent: agentCount > 0
              ? { state: "ready", detail: `${agentCount} registered agent${agentCount === 1 ? "" : "s"}.` }
              : { state: "pending", detail: "No agent is registered for this workspace." },
          },
        });
      });
    },
  };
}
