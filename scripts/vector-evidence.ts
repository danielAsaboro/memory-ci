import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { atomicWriteJson, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

export function assertProductionVectorConfiguration(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment.STASH_PRODUCTION_EVIDENCE !== "1") return;
  if (!environment.COCKROACH_CLUSTER_ID) throw new Error("COCKROACH_CLUSTER_ID is required for production vector evidence.");
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for production vector evidence.");
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a CockroachDB Cloud connection URL."); }
  if (!/\.cockroachlabs\.cloud$/i.test(url.hostname) || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error("Production vector evidence rejects local/private targets and requires a public CockroachDB Cloud hostname.");
  if (url.searchParams.get("sslmode") === "disable") throw new Error("Production vector evidence rejects local or insecure database URLs.");
}

async function main(): Promise<void> {
  assertProductionVectorConfiguration(process.env);
  const production = process.env.STASH_PRODUCTION_EVIDENCE === "1";
  const contextPath = process.env.STASH_EVIDENCE_CONTEXT_FILE;
  const context = production && contextPath ? validateEvidenceContext(JSON.parse(await readFile(contextPath, "utf8"))) : null;
  if (production && !context) throw new Error("STASH_EVIDENCE_CONTEXT_FILE is required for correlated production vector evidence.");
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
  const client = new Client({ connectionString: databaseUrl, application_name: "stash-vector-evidence" });
  await client.connect();
  try {
    const [version, identity, schema, indexes, seed] = await Promise.all([
      client.query<{ version: string }>("SELECT version()"),
      client.query<{ cluster_id: string }>("SELECT crdb_internal.cluster_id() AS cluster_id"),
      client.query<{ create_statement: string }>("SHOW CREATE TABLE memory_versions"),
      client.query<{ index_name: string; column_name: string; visible: boolean }>(
        "SELECT index_name,column_name,visible FROM [SHOW INDEX FROM memory_versions] WHERE index_name IN ('memory_versions_embedding_idx','memory_versions_active_lookup_idx') ORDER BY index_name,seq_in_index",
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
    const eligibleIndexes = [...new Set(indexes.rows.filter((row) => row.index_name.includes("embedding") && row.column_name === "embedding" && row.visible).map((row) => row.index_name))];
    const sqlClusterId = identity.rows[0]?.cluster_id;
    if (production && sqlClusterId !== process.env.COCKROACH_CLUSTER_ID) throw new Error("Authoritative CockroachDB SQL cluster identity does not match COCKROACH_CLUSTER_ID.");
    const probe = {
      schemaVersion: "1", capturedAt: new Date().toISOString(), environment: production ? "cockroach-cloud" : "local-cockroachdb",
      clusterId: production ? process.env.COCKROACH_CLUSTER_ID : null, sqlClusterId: sqlClusterId ?? null, serverVersion: version.rows[0]?.version,
      schemaHasVector1024: schema.rows[0]?.create_statement.includes("VECTOR(1024)") ?? false,
      eligibleIndexes, vectorIndexDefinitions: eligibleIndexes.filter((index) => schema.rows[0]?.create_statement.includes(`CREATE VECTOR INDEX ${index}`)),
      explainUsesVectorIndex: eligibleIndexes.some((index) => explainLines.some((line) => line.includes(index))),
      explain: explainLines,
    };
    if (production && (!probe.schemaHasVector1024 || probe.eligibleIndexes.length === 0 || probe.vectorIndexDefinitions.length !== probe.eligibleIndexes.length || !probe.explainUsesVectorIndex)) throw new Error("CockroachDB Cloud vector-index proof is incomplete.");
    const receipt = production ? { ...context!, kind: "vector", generatedAt: new Date().toISOString(), requestIds: { api: `sql:${sqlClusterId}`, trace: `index:${probe.eligibleIndexes[0]}` }, vector: probe } : probe;
    const output = process.argv[2];
    if (output) await atomicWriteJson(output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally { await client.end(); }
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
