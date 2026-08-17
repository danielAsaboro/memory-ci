import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ApiContext } from "../api/router";
import { createPool, withTenantTransaction } from "../db/client";
import { migrate } from "../db/migrate";
import { bootstrapWorkspace } from "./bootstrap-workspace";
import { createReadWorkspaceServices } from "./read-workspace";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `stash_reads_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();
const vector = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;

let admin: Client;
const pool = createPool(databaseUrl);

const contextFor = (tenantId: string, principalId: string): ApiContext => ({
  tenantId, principalId, requestId: "read-workspace-test", roles: ["admin"],
});

async function seedReadEvidence(workspace: Awaited<ReturnType<typeof bootstrapWorkspace>>) {
  const candidateId = randomUUID();
  const scenarioId = randomUUID();
  const evaluationId = randomUUID();
  let memoryId = "";
  await withTenantTransaction(pool, workspace.tenantId, async ({ client }) => {
    const starter = await client.query<{ id: string }>(
      "SELECT id FROM memory_versions WHERE tenant_id=$1 ORDER BY created_at LIMIT 1",
      [workspace.tenantId],
    );
    memoryId = starter.rows[0]!.id;
    await client.query(
      `INSERT INTO memory_candidates
       (tenant_id,id,namespace_id,state,memory_class,trust_class,canonical_payload,canonical_text,
        content_digest,source_id,created_by,embedding)
       VALUES ($1,$2,$3,'review_required','policy','authoritative',$4,$5,$6,$7,$8,$9::VECTOR)`,
      [workspace.tenantId, candidateId, workspace.namespaceId, { threshold: 200 }, "Review refunds over $200.",
        `candidate-${candidateId}`, await sourceId(client, workspace.tenantId), workspace.principalId, vector],
    );
    await client.query(
      `INSERT INTO evaluation_scenarios
       (tenant_id,id,namespace_id,name,input_payload,assertions,embedding)
       VALUES ($1,$2,$3,'Refund threshold', '{}', '{}', $4::VECTOR)`,
      [workspace.tenantId, scenarioId, workspace.namespaceId, vector],
    );
    await client.query(
      `INSERT INTO evaluation_runs
       (tenant_id,id,candidate_id,baseline_revision,policy_version,status,started_at,completed_at)
       VALUES ($1,$2,$3,1,'policy-v1','passed',now(),now())`,
      [workspace.tenantId, evaluationId, candidateId],
    );
    await client.query(
      `INSERT INTO evaluation_results
       (tenant_id,id,evaluation_run_id,scenario_id,status,baseline_trajectory,candidate_trajectory,
        behavioral_diff,deterministic_assertions)
       VALUES ($1,$2,$3,$4,'passed','{}','{}','{}','{}')`,
      [workspace.tenantId, randomUUID(), evaluationId, scenarioId],
    );
    await client.query(
      `INSERT INTO memory_reads
       (tenant_id,id,namespace_id,principal_id,revision,query_digest,returned_version_ids,purpose)
       VALUES ($1,$2,$3,$4,1,'read-digest',ARRAY[$5::UUID],'support')`,
      [workspace.tenantId, randomUUID(), workspace.namespaceId, workspace.agentId, memoryId],
    );
  });
  return { candidateId, evaluationId, memoryId };
}

async function sourceId(client: { query<T>(text: string, values: readonly unknown[]): Promise<{ rows: T[] }> }, tenantId: string): Promise<string> {
  const result = await client.query<{ id: string }>("SELECT id FROM sources WHERE tenant_id=$1 LIMIT 1", [tenantId]);
  return result.rows[0]!.id;
}

describe("workspace read models", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
    await admin?.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin?.end();
  });

  it("returns persisted dashboard read models only for the caller workspace", async () => {
    const first = await bootstrapWorkspace(pool, { idempotencyKey: "read-workspace-first", displayName: "First workspace" });
    const second = await bootstrapWorkspace(pool, { idempotencyKey: "read-workspace-second", displayName: "Second workspace" });
    const firstEvidence = await seedReadEvidence(first);
    const secondEvidence = await seedReadEvidence(second);
    const services = createReadWorkspaceServices(pool);
    const context = contextFor(first.tenantId, first.principalId);

    const [overview, agents, memories, memory, evaluations, evaluation, candidates, candidate, audit, workspace] = await Promise.all([
      services.getOverview(context, {}),
      services.listAgents(context, {}),
      services.listMemories(context, {}),
      services.getMemory(context, { memoryId: firstEvidence.memoryId }),
      services.listEvaluations(context, {}),
      services.getEvaluation(context, { evaluationRunId: firstEvidence.evaluationId }),
      services.listCandidates(context, {}),
      services.getCandidate(context, { candidateId: firstEvidence.candidateId }),
      services.listAudit(context, {}),
      services.getWorkspaceStatus(context, {}),
    ]);

    expect(overview).toMatchObject({
      workspace: { id: first.tenantId, name: "First workspace" },
      metrics: { agents: 1, activeMemories: 1, candidates: 2, evaluations: 1, auditEvents: 1 },
    });
    expect(agents).toEqual([expect.objectContaining({ id: first.agentId, namespaceIds: [first.namespaceId], reads: 1 })]);
    expect(memories).toEqual([expect.objectContaining({ id: firstEvidence.memoryId, active: true })]);
    expect(memory).toMatchObject({ id: firstEvidence.memoryId, lineage: [expect.objectContaining({ id: firstEvidence.memoryId })] });
    expect(evaluations).toEqual([expect.objectContaining({ id: firstEvidence.evaluationId, candidateId: firstEvidence.candidateId, resultCount: 1 })]);
    expect(evaluation).toMatchObject({ id: firstEvidence.evaluationId, results: [expect.objectContaining({ status: "passed" })] });
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ id: firstEvidence.candidateId, state: "review_required" })]));
    expect(candidates).toHaveLength(2);
    expect(candidate).toMatchObject({ id: firstEvidence.candidateId, canonicalText: "Review refunds over $200." });
    expect(audit).toEqual([expect.objectContaining({ action: "workspace.created", actor: expect.objectContaining({ id: first.principalId }) })]);
    expect(workspace).toMatchObject({ workspace: { id: first.tenantId, name: "First workspace" } });
    expect(workspace.integrations.cockroach.state).toBe("ready");

    const serialized = JSON.stringify({ overview, agents, memories, memory, evaluations, evaluation, candidates, candidate, audit, workspace });
    expect(serialized).not.toContain(second.tenantId);
    expect(serialized).not.toContain(secondEvidence.candidateId);
    expect(serialized).not.toContain(secondEvidence.evaluationId);
    expect(serialized).not.toContain(secondEvidence.memoryId);
  });
});
