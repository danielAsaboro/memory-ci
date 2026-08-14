import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPool, withTenantTransaction } from "../db/client";
import { migrate } from "../db/migrate";
import { analyzeImpact, explainImpactQuery } from "./analyze-impact";
import { selectScenarios } from "./select-scenarios";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `memory_ci_impact_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => { const url = new URL(adminUrl); url.pathname = `/${databaseName}`; return url.toString(); })();
const vector = (value: number) => `[${Array.from({ length: 1024 }, () => value).join(",")}]`;

let admin: Client;
const pool = createPool(databaseUrl);
let tenantId: string;
let principalId: string;
let namespaceId: string;
let candidateId: string;
let activeVersionId: string;
let activeScenarioId: string;

async function seedTenant(slug: string) {
  const tenant = randomUUID();
  const principal = randomUUID();
  const namespace = randomUUID();
  const source = randomUUID();
  await withTenantTransaction(pool, tenant, async ({ client }) => {
    await client.query("INSERT INTO tenants (id,slug,name) VALUES ($1,$2,$2)", [tenant, slug]);
    await client.query("INSERT INTO principals (tenant_id,id,kind,display_name) VALUES ($1,$2,'human','Owner')", [tenant, principal]);
    await client.query("INSERT INTO agent_namespaces (tenant_id,id,slug,name) VALUES ($1,$2,'refunds','Refunds')", [tenant, namespace]);
    await client.query(
      `INSERT INTO sources (tenant_id,id,source_type,trust_class,content_digest,submitted_by)
       VALUES ($1,$2,'operator','authoritative',$3,$4)`,
      [tenant, source, `source-${slug}`, principal],
    );
  });
  return { tenant, principal, namespace, source };
}

async function seedMemory(input: {
  tenant: string; principal: string; namespace: string; source: string;
  digest: string; active: boolean; embedding: string;
}) {
  const candidate = randomUUID();
  const lineage = randomUUID();
  const version = randomUUID();
  await withTenantTransaction(pool, input.tenant, async ({ client }) => {
    await client.query(
      `INSERT INTO memory_candidates
       (tenant_id,id,namespace_id,state,memory_class,trust_class,canonical_payload,canonical_text,
        content_digest,source_id,created_by,embedding)
       VALUES ($1,$2,$3,$4,'policy','authoritative',$5,$6,$7,$8,$9,$10::VECTOR)`,
      [input.tenant, candidate, input.namespace, input.active ? "active" : "superseded",
        { rule: input.digest }, input.digest, input.digest, input.source, input.principal, input.embedding],
    );
    await client.query(
      "INSERT INTO memory_lineages (tenant_id,id,namespace_id,stable_key) VALUES ($1,$2,$3,$4)",
      [input.tenant, lineage, input.namespace, input.digest],
    );
    await client.query(
      `INSERT INTO memory_versions
       (tenant_id,id,namespace_id,lineage_id,candidate_id,version,revision,active,memory_class,
        canonical_payload,canonical_text,content_digest,embedding)
       VALUES ($1,$2,$3,$4,$5,1,1,$6,'policy',$7,$8,$9,$10::VECTOR)`,
      [input.tenant, version, input.namespace, lineage, candidate, input.active,
        { rule: input.digest }, input.digest, input.digest, input.embedding],
    );
  });
  return version;
}

describe("vector impact analysis", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);

    const primary = await seedTenant(`impact-${randomUUID()}`);
    tenantId = primary.tenant;
    principalId = primary.principal;
    namespaceId = primary.namespace;
    activeVersionId = await seedMemory({ ...primary, digest: "active-refund-policy", active: true, embedding: vector(0.1) });
    await seedMemory({ ...primary, digest: "inactive-policy", active: false, embedding: vector(0.1) });

    const unrelatedNamespace = randomUUID();
    await withTenantTransaction(pool, tenantId, ({ client }) => client.query(
      "INSERT INTO agent_namespaces (tenant_id,id,slug,name) VALUES ($1,$2,'shipping','Shipping')",
      [tenantId, unrelatedNamespace],
    ).then(() => undefined));
    await seedMemory({ ...primary, namespace: unrelatedNamespace, digest: "unrelated-policy", active: true, embedding: vector(0.1) });

    const other = await seedTenant(`other-${randomUUID()}`);
    await seedMemory({ ...other, digest: "other-tenant-policy", active: true, embedding: vector(0.1) });

    candidateId = randomUUID();
    await withTenantTransaction(pool, tenantId, async ({ client }) => {
      await client.query(
        `INSERT INTO memory_candidates
         (tenant_id,id,namespace_id,state,memory_class,trust_class,canonical_payload,canonical_text,
          content_digest,source_id,created_by,embedding)
         VALUES ($1,$2,$3,'evaluating','policy','authoritative',$4,$5,'candidate-impact',$6,$7,$8::VECTOR)`,
        [tenantId, candidateId, namespaceId, { refundReviewThreshold: 150 },
          "Raise the refund review threshold to $150", primary.source, principalId, vector(0.1)],
      );
      activeScenarioId = randomUUID();
      await client.query(
        `INSERT INTO evaluation_scenarios
         (tenant_id,id,namespace_id,name,input_payload,assertions,embedding,active)
         VALUES ($1,$2,$3,'high value refund',$4,$5,$6::VECTOR,true),
                ($1,$7,$3,'retired refund',$4,$5,$6::VECTOR,false)`,
        [tenantId, activeScenarioId, namespaceId, { amount: 125 }, { requiresReview: true }, vector(0.1), randomUUID()],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin.end();
  });

  it("retrieves only active same-tenant namespace/class memories and persists typed evidence", async () => {
    const report = await withTenantTransaction(pool, tenantId, (transaction) => analyzeImpact(transaction, candidateId, {
      classify: async ({ candidate, memory, distance }) => ({
        relationType: "contradicts",
        confidence: 0.97,
        evidence: { candidateDigest: candidate.contentDigest, memoryDigest: memory.contentDigest, distance, basis: "threshold_conflict" },
      }),
    }));

    expect(report.matches).toHaveLength(1);
    expect(report.matches[0]).toMatchObject({ memoryVersionId: activeVersionId, relationType: "contradicts" });
    const stored = await withTenantTransaction(pool, tenantId, ({ client }) => client.query(
      "SELECT relation_type,evidence FROM memory_relations WHERE tenant_id=$1 AND from_candidate_id=$2",
      [tenantId, candidateId],
    ));
    expect(stored.rows).toEqual([expect.objectContaining({
      relation_type: "contradicts",
      evidence: expect.objectContaining({ basis: "threshold_conflict", memoryDigest: "active-refund-policy" }),
    })]);
  });

  it("selects only active scenarios in the candidate namespace", async () => {
    const scenarios = await withTenantTransaction(pool, tenantId, (transaction) => selectScenarios(transaction, candidateId, 10));
    expect(scenarios.map((scenario) => scenario.id)).toEqual([activeScenarioId]);
  });

  it("uses the prefix-constrained cosine query shape required by the vector index", async () => {
    const evidence = await withTenantTransaction(pool, tenantId, async (transaction) => ({
      plan: await explainImpactQuery(transaction, {
        namespaceId, memoryClass: "policy", embedding: vector(0.1), limit: 10,
      }),
      schema: await transaction.client.query<{ create_statement: string }>("SHOW CREATE TABLE memory_versions"),
    }));
    const plan = evidence.plan.join("\n");
    const schema = evidence.schema.rows[0]?.create_statement ?? "";
    // Tiny fixtures can rationally choose an exact scan; eligibility comes from
    // exact prefix predicates plus the matching cosine operator/index definition.
    expect(plan).toMatch(/order: \+distance/);
    expect(plan).toMatch(/memory_class = 'policy'|spans: .*\/'policy'/);
    expect(plan).toMatch(/active|memory_versions_active_lookup_idx \(partial index\)/);
    expect(schema).toMatch(/VECTOR INDEX memory_versions_embedding_idx \(tenant_id, namespace_id, memory_class, embedding vector_cosine_ops\)/);
  });
});
