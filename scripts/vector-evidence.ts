import { Client } from "pg";

import { northstarFixture as ids } from "../src/fixtures/northstar";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const client = new Client({ connectionString: databaseUrl, application_name: "memory-ci-vector-evidence" });

await client.connect();
try {
  const version = await client.query<{ version: string }>("SELECT version()");
  const schema = await client.query<{ create_statement: string }>("SHOW CREATE TABLE memory_versions");
  const indexes = await client.query<{ index_name: string; non_unique: boolean; column_name: string; seq_in_index: number; visible: boolean }>(
    "SELECT index_name,non_unique,column_name,seq_in_index,visible FROM [SHOW INDEX FROM memory_versions] WHERE index_name IN ('memory_versions_embedding_idx','memory_versions_one_active_idx','memory_versions_active_lookup_idx') ORDER BY index_name,seq_in_index",
  );
  const candidate = await client.query<{ embedding: string }>(
    "SELECT embedding FROM memory_candidates WHERE tenant_id=$1 AND id=$2",
    [ids.tenantId, ids.proposedCandidateId],
  );
  if (!candidate.rows[0]) throw new Error("Run npm run demo:seed before collecting vector evidence.");
  const vector = candidate.rows[0].embedding;
  const query = `SELECT id,content_digest,embedding <=> $4::VECTOR AS distance
    FROM memory_versions
    WHERE tenant_id=$1 AND namespace_id=$2 AND memory_class=$3 AND active
    ORDER BY embedding <=> $4::VECTOR
    LIMIT 5`;
  const parameters = [ids.tenantId, ids.namespaceId, "policy", vector];

  // The official cockroachdb-sql Agent Skill requires EXPLAIN before execution.
  const explain = await client.query<Record<string, string>>(`EXPLAIN ${query}`, parameters);
  const neighbors = await client.query<{ id: string; content_digest: string; distance: string }>(query, parameters);
  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    environment: process.env.COCKROACH_CLUSTER_ID ? "cockroach-cloud" : "local-cockroachdb",
    clusterId: process.env.COCKROACH_CLUSTER_ID ?? null,
    serverVersion: version.rows[0]?.version,
    schemaHasVector1024: schema.rows[0]?.create_statement.includes("VECTOR(1024)") ?? false,
    indexes: indexes.rows,
    filters: { tenantId: ids.tenantId, namespaceId: ids.namespaceId, memoryClass: "policy", active: true },
    explain: explain.rows.map((row) => Object.values(row).join(" ")),
    neighbors: neighbors.rows.map((row) => ({ ...row, distance: Number(row.distance) })),
  }, null, 2));
} finally {
  await client.end();
}
