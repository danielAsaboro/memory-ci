import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrate";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `memory_ci_test_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

let admin: Client;
let database: Client;

describe("CockroachDB migrations", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
  });

  afterAll(async () => {
    await database?.end();
    await admin?.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin?.end();
  });

  it("creates the complete schema and remains idempotent", async () => {
    await migrate(databaseUrl);
    await migrate(databaseUrl);

    const result = await database.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "activation_events",
      "agent_namespaces",
      "audit_events",
      "evaluation_results",
      "evaluation_runs",
      "evaluation_scenarios",
      "idempotency_keys",
      "memory_candidates",
      "memory_lineages",
      "memory_reads",
      "memory_relations",
      "memory_versions",
      "outbox_events",
      "principals",
      "reviews",
      "schema_migrations",
      "screening_findings",
      "source_artifacts",
      "sources",
      "tenants",
    ]);
  });

  it("rejects invalid candidate lifecycle states", async () => {
    await migrate(databaseUrl);
    const tenantId = randomUUID();
    const principalId = randomUUID();
    const namespaceId = randomUUID();
    const sourceId = randomUUID();

    await database.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [
      tenantId,
      `tenant-${tenantId}`,
      "Test tenant",
    ]);
    await database.query(
      "INSERT INTO principals (id, tenant_id, kind, display_name) VALUES ($1, $2, 'human', 'Reviewer')",
      [principalId, tenantId],
    );
    await database.query(
      "INSERT INTO agent_namespaces (id, tenant_id, slug, name) VALUES ($1, $2, 'refunds', 'Refunds')",
      [namespaceId, tenantId],
    );
    await database.query(
      `INSERT INTO sources
       (id, tenant_id, source_type, trust_class, content_digest, submitted_by)
       VALUES ($1, $2, 'document', 'authoritative', 'digest', $3)`,
      [sourceId, tenantId, principalId],
    );

    await expect(
      database.query(
        `INSERT INTO memory_candidates
         (id, tenant_id, namespace_id, state, memory_class, trust_class,
          canonical_payload, content_digest, source_id, created_by)
         VALUES ($1, $2, $3, 'silently_active', 'policy', 'authoritative', '{}', 'candidate-digest', $4, $5)`,
        [randomUUID(), tenantId, namespaceId, sourceId, principalId],
      ),
    ).rejects.toThrow(/check constraint|violates/i);
  });

  it("enforces fixed vector dimensions", async () => {
    await migrate(databaseUrl);
    const tenantId = randomUUID();
    const namespaceId = randomUUID();
    const lineageId = randomUUID();
    const candidateId = randomUUID();
    const principalId = randomUUID();
    const sourceId = randomUUID();

    await database.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [
      tenantId,
      `vector-${tenantId}`,
      "Vector tenant",
    ]);
    await database.query(
      "INSERT INTO principals (id, tenant_id, kind, display_name) VALUES ($1, $2, 'human', 'Reviewer')",
      [principalId, tenantId],
    );
    await database.query(
      "INSERT INTO agent_namespaces (id, tenant_id, slug, name) VALUES ($1, $2, 'policy', 'Policy')",
      [namespaceId, tenantId],
    );
    await database.query(
      `INSERT INTO sources
       (id, tenant_id, source_type, trust_class, content_digest, submitted_by)
       VALUES ($1, $2, 'document', 'authoritative', 'vector-source', $3)`,
      [sourceId, tenantId, principalId],
    );
    await database.query(
      `INSERT INTO memory_candidates
       (id, tenant_id, namespace_id, state, memory_class, trust_class,
        canonical_payload, content_digest, source_id, created_by)
       VALUES ($1, $2, $3, 'approved', 'policy', 'authoritative', '{}', 'vector-candidate', $4, $5)`,
      [candidateId, tenantId, namespaceId, sourceId, principalId],
    );
    await database.query(
      "INSERT INTO memory_lineages (id, tenant_id, namespace_id, stable_key) VALUES ($1, $2, $3, 'refund-policy')",
      [lineageId, tenantId, namespaceId],
    );

    await expect(
      database.query(
        `INSERT INTO memory_versions
         (id, tenant_id, namespace_id, lineage_id, candidate_id, version, revision,
          active, memory_class, canonical_payload, content_digest, embedding)
         VALUES ($1, $2, $3, $4, $5, 1, 1, true, 'policy', '{}', 'bad-vector', '[1,2,3]'::VECTOR)`,
        [randomUUID(), tenantId, namespaceId, lineageId, candidateId],
      ),
    ).rejects.toThrow(/dimension|vector/i);
  });

  it("does not grant the application role permission to rewrite audit history", async () => {
    await migrate(databaseUrl);
    await database.query("SET ROLE memory_ci_app");
    await expect(database.query("UPDATE audit_events SET action = 'rewritten' WHERE false")).rejects.toThrow(
      /permission|privilege/i,
    );
    await database.query("RESET ROLE");
  });
});
