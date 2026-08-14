import { createPool, withTenantTransaction } from "../src/db/client";
import { migrate } from "../src/db/migrate";
import { northstarFixture as ids } from "../src/fixtures/northstar";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
await migrate(databaseUrl);
const pool = createPool(databaseUrl);
const dependentTables = [
  "idempotency_keys", "audit_events", "outbox_events", "memory_reads", "activation_events", "reviews",
  "evaluation_results", "evaluation_runs", "evaluation_scenarios", "screening_findings", "memory_relations",
  "memory_versions", "memory_candidates", "memory_lineages", "source_artifacts", "sources", "agent_namespaces", "principals",
] as const;

try {
  await withTenantTransaction(pool, ids.tenantId, async ({ client }) => {
    for (const table of dependentTables) {
      await client.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [ids.tenantId]);
    }
    await client.query("DELETE FROM tenants WHERE id = $1", [ids.tenantId]);
  });
  console.log(JSON.stringify({ ok: true, removedSandboxTenant: ids.tenantId }));
} finally {
  await pool.end();
}
