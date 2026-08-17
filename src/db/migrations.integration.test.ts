import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
const migrationDirectory = fileURLToPath(new URL("../../db/migrations", import.meta.url));

let admin: Client;
let database: Client;

async function migrateThrough005(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE schema_migrations (
      name STRING PRIMARY KEY, checksum STRING NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql") && file <= "005_workspace_sessions.sql")
      .sort((left, right) => left.localeCompare(right));
    for (const file of files) {
      const sql = await readFile(path.join(migrationDirectory, file), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name,checksum) VALUES ($1,$2)", [
        file, createHash("sha256").update(sql).digest("hex"),
      ]);
    }
  } finally {
    await client.end();
  }
}

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
      "workspace_bootstraps",
    ]);
    const applied = await database.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(applied.rows.map((row) => row.name)).toEqual([
      "001_initial.sql", "002_vector_indexes.sql", "003_security_roles.sql",
      "004_active_lookup_covering_index.sql", "005_workspace_sessions.sql", "006_tenant_bound_workspace_bootstraps.sql",
    ]);
  });

  it("keys workspace bootstrap idempotency by tenant and key", async () => {
    await migrate(databaseUrl);
    const primaryKey = await database.query<{ column_name: string }>(
      `SELECT column_name FROM [SHOW INDEX FROM workspace_bootstraps]
       WHERE index_name='workspace_bootstraps_pkey' AND storing=false ORDER BY seq_in_index`,
    );

    expect(primaryKey.rows.map((row) => row.column_name)).toEqual(["tenant_id", "idempotency_key"]);
  });

  it("upgrades an existing 005 workspace bootstrap row to the tenant-bound primary key", async () => {
    const upgradeDatabaseName = `memory_ci_upgrade_${randomUUID().replaceAll("-", "")}`;
    const upgradeDatabaseUrl = new URL(adminUrl);
    upgradeDatabaseUrl.pathname = `/${upgradeDatabaseName}`;
    await admin.query(`CREATE DATABASE ${upgradeDatabaseName}`);
    const upgrade = new Client({ connectionString: upgradeDatabaseUrl.toString() });
    try {
      await migrateThrough005(upgradeDatabaseUrl.toString());
      await upgrade.connect();
      const tenantId = randomUUID();
      const principalId = randomUUID();
      const namespaceId = randomUUID();
      const agentId = randomUUID();
      await upgrade.query("INSERT INTO tenants (id,slug,name) VALUES ($1,$2,'Upgrade Workspace')", [tenantId, `upgrade-${tenantId}`]);
      await upgrade.query(
        `INSERT INTO principals (tenant_id,id,kind,display_name) VALUES
         ($1,$2,'human','Owner'),($1,$3,'agent','Agent')`,
        [tenantId, principalId, agentId],
      );
      await upgrade.query(
        "INSERT INTO agent_namespaces (tenant_id,id,slug,name) VALUES ($1,$2,'refunds','Refund policy')",
        [tenantId, namespaceId],
      );
      await upgrade.query(
        `INSERT INTO workspace_bootstraps
         (idempotency_key,tenant_id,principal_id,namespace_id,agent_id,workspace_name)
         VALUES ('upgrade-bootstrap-key',$1,$2,$3,$4,'Upgrade Workspace')`,
        [tenantId, principalId, namespaceId, agentId],
      );

      await migrate(upgradeDatabaseUrl.toString());

      const persisted = await upgrade.query<{ tenant_id: string; workspace_name: string }>(
        "SELECT tenant_id,workspace_name FROM workspace_bootstraps WHERE tenant_id=$1 AND idempotency_key='upgrade-bootstrap-key'",
        [tenantId],
      );
      const secondTenantId = randomUUID();
      const secondPrincipalId = randomUUID();
      const secondNamespaceId = randomUUID();
      const secondAgentId = randomUUID();
      await upgrade.query("INSERT INTO tenants (id,slug,name) VALUES ($1,$2,'Second Upgrade Workspace')", [secondTenantId, `upgrade-${secondTenantId}`]);
      await upgrade.query(
        `INSERT INTO principals (tenant_id,id,kind,display_name) VALUES
         ($1,$2,'human','Second owner'),($1,$3,'agent','Second agent')`,
        [secondTenantId, secondPrincipalId, secondAgentId],
      );
      await upgrade.query(
        "INSERT INTO agent_namespaces (tenant_id,id,slug,name) VALUES ($1,$2,'refunds','Refund policy')",
        [secondTenantId, secondNamespaceId],
      );
      await upgrade.query(
        `INSERT INTO workspace_bootstraps
         (idempotency_key,tenant_id,principal_id,namespace_id,agent_id,workspace_name)
         VALUES ('upgrade-bootstrap-key',$1,$2,$3,$4,'Second Upgrade Workspace')`,
        [secondTenantId, secondPrincipalId, secondNamespaceId, secondAgentId],
      );
      const primaryKey = await upgrade.query<{ column_name: string }>(
        `SELECT column_name FROM [SHOW INDEX FROM workspace_bootstraps]
         WHERE index_name='workspace_bootstraps_pkey' AND storing=false ORDER BY seq_in_index`,
      );
      const legacyGlobalUniqueIndex = await upgrade.query<{ index_name: string }>(
        `SELECT index_name FROM [SHOW INDEX FROM workspace_bootstraps]
         WHERE index_name='workspace_bootstraps_idempotency_key_key'
           AND non_unique=false AND column_name='idempotency_key' AND seq_in_index=1 AND storing=false`,
      );

      expect(persisted.rows).toEqual([{ tenant_id: tenantId, workspace_name: "Upgrade Workspace" }]);
      expect(primaryKey.rows.map((row) => row.column_name)).toEqual(["tenant_id", "idempotency_key"]);
      expect(legacyGlobalUniqueIndex.rows).toEqual([]);
    } finally {
      await upgrade.end().catch(() => undefined);
      await admin.query(`DROP DATABASE ${upgradeDatabaseName} CASCADE`);
    }
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

  it("covers active vector lookup filters without fetching base rows", async () => {
    await migrate(databaseUrl);
    const index = await database.query<{ column_name: string; storing: boolean }>(
      `SELECT column_name,storing
       FROM [SHOW INDEX FROM memory_versions]
       WHERE index_name='memory_versions_active_lookup_idx'
       ORDER BY seq_in_index`,
    );
    expect(index.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining([
      "tenant_id", "namespace_id", "memory_class", "active", "embedding", "canonical_text",
    ]));
    expect(index.rows.some((row) => row.column_name === "embedding" && row.storing)).toBe(true);
  });

  it("does not grant the application role permission to rewrite audit history", async () => {
    await migrate(databaseUrl);
    await database.query("SET ROLE memory_ci_app");
    await expect(database.query("UPDATE audit_events SET action = 'rewritten' WHERE false")).rejects.toThrow(
      /permission|privilege/i,
    );
    await database.query("RESET ROLE");
  });

  it("creates a read-only auditor role and protects append-only release evidence", async () => {
    await migrate(databaseUrl);
    await database.query("SET ROLE memory_ci_auditor");
    await expect(database.query("SELECT id FROM audit_events LIMIT 1")).resolves.toBeDefined();
    await expect(database.query("INSERT INTO audit_events (tenant_id,id,actor_id,action,resource_type,resource_id,request_id,event_digest) VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'x','x',gen_random_uuid(),'x','x')")).rejects.toThrow(/permission|privilege/i);
    await database.query("RESET ROLE");

    await database.query("SET ROLE memory_ci_app");
    await expect(database.query("DELETE FROM activation_events WHERE false")).rejects.toThrow(/permission|privilege/i);
    await expect(database.query("UPDATE reviews SET reason = reason WHERE false")).rejects.toThrow(/permission|privilege/i);
    await database.query("RESET ROLE");
  });
});
