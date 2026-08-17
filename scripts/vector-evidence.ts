import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { Client } from "pg";

export function assertProductionVectorConfiguration(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment.STASH_PRODUCTION_EVIDENCE !== "1") return;
  if (!environment.COCKROACH_CLUSTER_ID) throw new Error("COCKROACH_CLUSTER_ID is required for production vector evidence.");
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for production vector evidence.");
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a CockroachDB Cloud connection URL."); }
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.searchParams.get("sslmode") === "disable") throw new Error("Production vector evidence rejects local or insecure database URLs.");
}

async function main(): Promise<void> {
  assertProductionVectorConfiguration(process.env);
  const production = process.env.STASH_PRODUCTION_EVIDENCE === "1";
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
  const client = new Client({ connectionString: databaseUrl, application_name: "stash-vector-evidence" });
  await client.connect();
  try {
    const [version, schema, indexes, seed] = await Promise.all([
      client.query<{ version: string }>("SELECT version()"),
      client.query<{ create_statement: string }>("SHOW CREATE TABLE memory_versions"),
      client.query<{ index_name: string; column_name: string }>(
        "SELECT index_name,column_name FROM [SHOW INDEX FROM memory_versions] WHERE index_name IN ('memory_versions_embedding_idx','memory_versions_active_lookup_idx') ORDER BY index_name,seq_in_index",
      ),
      client.query<{ tenant_id: string; namespace_id: string; memory_class: string; embedding: string }>(
        "SELECT tenant_id,namespace_id,memory_class,embedding FROM memory_versions WHERE active AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      ),
    ]);
    const sample = seed.rows[0];
    if (!sample) throw new Error("Vector evidence requires a persisted active memory; no fixture data is accepted as production proof.");
    const query = `SELECT id,embedding <=> $4::VECTOR AS distance FROM memory_versions
      WHERE tenant_id=$1 AND namespace_id=$2 AND memory_class=$3 AND active
      ORDER BY embedding <=> $4::VECTOR LIMIT 5`;
    const explain = await client.query<Record<string, string>>(`EXPLAIN ${query}`, [sample.tenant_id, sample.namespace_id, sample.memory_class, sample.embedding]);
    const explainLines = explain.rows.map((row) => Object.values(row).join(" "));
    const eligibleIndexes = [...new Set(indexes.rows.filter((row) => row.index_name.includes("embedding")).map((row) => row.index_name))];
    const receipt = {
      schemaVersion: "1", capturedAt: new Date().toISOString(), environment: production ? "cockroach-cloud" : "local-cockroachdb",
      clusterId: production ? process.env.COCKROACH_CLUSTER_ID : null, serverVersion: version.rows[0]?.version,
      schemaHasVector1024: schema.rows[0]?.create_statement.includes("VECTOR(1024)") ?? false,
      eligibleIndexes, explainUsesVectorIndex: eligibleIndexes.some((index) => explainLines.some((line) => line.includes(index))),
      explain: explainLines,
    };
    if (production && (!receipt.schemaHasVector1024 || receipt.eligibleIndexes.length === 0 || !receipt.explainUsesVectorIndex)) throw new Error("CockroachDB Cloud vector-index proof is incomplete.");
    const output = process.argv[2];
    if (output) await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally { await client.end(); }
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Vector evidence failed."}\n`); process.exitCode = 1; });
