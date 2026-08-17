import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { atomicWriteJson, receiptSchema, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

type VectorIndexJob = Readonly<{ job_id: string; status: string; finished: string | null; description: string }>;
export async function loadFullVectorIndexJobs(client: { query(sql: string): Promise<{ rows: unknown[] }> }, summaries: readonly VectorIndexJob[]): Promise<VectorIndexJob[]> {
  const full: VectorIndexJob[] = [];
  for (const summary of summaries) {
    if (!/^\d+$/.test(summary.job_id)) throw new Error("CockroachDB returned an invalid vector-index job ID.");
    const result = await client.query(`SHOW JOB ${summary.job_id}`);
    const row = result.rows[0];
    if (!row || typeof row !== "object") throw new Error("CockroachDB did not return the retained vector-index job details.");
    const record = row as Record<string, unknown>;
    if (typeof record.description !== "string" || typeof record.status !== "string") throw new Error("CockroachDB returned malformed vector-index job details.");
    full.push({ job_id: String(record.job_id), status: record.status, finished: record.finished ? new Date(String(record.finished)).toISOString() : null, description: record.description });
  }
  return full;
}

export function hasVectorIndexDefinition(createStatement: string, indexName: string): boolean {
  const escaped = indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,(])vector index ${escaped}\\s*\\(`, "i").test(createStatement);
}

export function selectReadyVectorIndexJob(rows: readonly VectorIndexJob[], indexName: string, tableName: string, databaseName?: string): VectorIndexJob {
  const normalized = (value: string) => value.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase();
  const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const qualifier = databaseName ? `(?:(?:${escapeForRegExp(databaseName)}\\.)?public\\.)?` : "(?:public\\.)?";
  const expected = new RegExp(`^create vector index(?: if not exists)? ${escapeForRegExp(indexName)} on ${qualifier}${escapeForRegExp(tableName)}(?=\\s|\\(|;|$)`);
  const matching = rows.filter((job) => expected.test(normalized(job.description)));
  const latest = matching[0];
  if (!latest) throw new Error("No retained matching vector-index job exists; rerun the index migration and then evidence collection.");
  if (latest.status.toLowerCase() !== "succeeded" || !latest.finished) throw new Error("Latest matching vector-index job is not succeeded; rerun or repair the index migration before evidence collection.");
  return latest;
}

export function assertProductionVectorConfiguration(environment: Readonly<Record<string, string | undefined>>): void {
  if (environment.STASH_PRODUCTION_EVIDENCE !== "1") return;
  if (!environment.COCKROACH_CLUSTER_ID) throw new Error("COCKROACH_CLUSTER_ID is required for production vector evidence.");
  if (!environment.COCKROACH_SQL_CLUSTER_ID) throw new Error("COCKROACH_SQL_CLUSTER_ID is required for production vector evidence.");
  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for production vector evidence.");
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a CockroachDB Cloud connection URL."); }
  if (!/\.cockroachlabs\.cloud$/i.test(url.hostname) || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error("Production vector evidence rejects local/private targets and requires a public CockroachDB Cloud hostname.");
  if (url.searchParams.get("sslmode") !== "verify-full") throw new Error("Production vector evidence requires sslmode=verify-full.");
}

async function main(): Promise<void> {
  assertProductionVectorConfiguration(process.env);
  const production = process.env.STASH_PRODUCTION_EVIDENCE === "1";
  const contextPath = process.env.STASH_EVIDENCE_CONTEXT_FILE;
  const context = production && contextPath ? validateEvidenceContext(JSON.parse(await readFile(contextPath, "utf8"))) : null;
  if (production && !context) throw new Error("STASH_EVIDENCE_CONTEXT_FILE is required for correlated production vector evidence.");
  const smokePath = process.env.STASH_SMOKE_EVIDENCE_FILE;
  if (production && !smokePath) throw new Error("STASH_SMOKE_EVIDENCE_FILE is required to bind vector proof to this production run.");
  const smoke = production ? receiptSchema.parse(JSON.parse(await readFile(smokePath!, "utf8"))) : null;
  const smokeProbe = smoke?.kind === "aws-smoke" ? smoke.probe : null;
  if (production && (!smokeProbe || smoke!.runId !== context!.runId)) throw new Error("Production vector evidence requires the exact correlated AWS smoke receipt.");
  const databaseUrl = process.env.DATABASE_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
  if (production && !/^[A-Za-z0-9_-]+$/.test(databaseName)) throw new Error("Production vector evidence requires an explicit CockroachDB database name.");
  const client = new Client({ connectionString: databaseUrl, application_name: "stash-vector-evidence" });
  await client.connect();
  try {
    if (production) await client.query("SET allow_unsafe_internals = on");
    const version = await client.query<{ version: string }>("SELECT version()");
    const identity = await client.query<{ cluster_id: string }>("SELECT crdb_internal.cluster_id() AS cluster_id");
    const columns = await client.query<{ column_name: string; data_type: string }>("SELECT column_name,data_type FROM [SHOW COLUMNS FROM memory_versions] WHERE column_name='embedding'");
    const schema = await client.query<{ create_statement: string }>("SHOW CREATE TABLE memory_versions");
    const indexes = await client.query<{ index_name: string; column_name: string; visible: boolean }>(
      "SELECT index_name,column_name,visible FROM [SHOW INDEX FROM memory_versions] WHERE index_name IN ('memory_versions_active_embedding_idx','memory_versions_active_lookup_idx') ORDER BY index_name,seq_in_index",
    );
    const jobSummaries = await client.query<VectorIndexJob>("SELECT job_id::STRING,status,finished::STRING,description FROM [SHOW JOBS] WHERE lower(description) LIKE 'create vector index%' ORDER BY created DESC LIMIT 50");
    const jobs = production ? await loadFullVectorIndexJobs(client, jobSummaries.rows) : jobSummaries.rows;
    const seed = await client.query<{ id: string; tenant_id: string; namespace_id: string; memory_class: string; embedding: string }>(
      production ? "SELECT id,tenant_id,namespace_id,memory_class,embedding FROM memory_versions WHERE tenant_id=$1 AND id=$2 AND active AND embedding IS NOT NULL" : "SELECT id,tenant_id,namespace_id,memory_class,embedding FROM memory_versions WHERE active AND embedding IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      production ? [smokeProbe!.tenantId, smokeProbe!.memoryId] : [],
    );
    const sample = seed.rows[0];
    if (!sample) throw new Error("Vector evidence requires a persisted active memory; no fixture data is accepted as production proof.");
    const query = `SELECT id,embedding <=> $3::VECTOR AS distance FROM memory_versions@memory_versions_active_embedding_idx
      WHERE tenant_id=$1 AND namespace_id=$2 AND active
      ORDER BY embedding <=> $3::VECTOR LIMIT 5`;
    const explain = await client.query<Record<string, string>>(`EXPLAIN ${query}`, [sample.tenant_id, sample.namespace_id, sample.embedding]);
    const explainLines = explain.rows.map((row) => Object.values(row).join(" "));
    const eligibleIndexes = [...new Set(indexes.rows.filter((row) => row.index_name === "memory_versions_active_embedding_idx" && row.column_name === "embedding" && row.visible).map((row) => row.index_name))];
    const indexJob = production ? selectReadyVectorIndexJob(jobs, "memory_versions_active_embedding_idx", "memory_versions", databaseName) : null;
    const sqlClusterId = identity.rows[0]?.cluster_id;
    if (production && sqlClusterId !== process.env.COCKROACH_SQL_CLUSTER_ID) throw new Error("Authoritative CockroachDB SQL cluster identity does not match COCKROACH_SQL_CLUSTER_ID.");
    const probe = {
      schemaVersion: "1", capturedAt: new Date().toISOString(), environment: production ? "cockroach-cloud" : "local-cockroachdb",
      clusterId: production ? process.env.COCKROACH_CLUSTER_ID : null, sqlClusterId: sqlClusterId ?? null, serverVersion: version.rows[0]?.version,
      schemaHasVector1024: columns.rows[0]?.column_name === "embedding" && columns.rows[0]?.data_type === "VECTOR(1024)",
      eligibleIndexes, vectorIndexDefinitions: eligibleIndexes.filter((index) => hasVectorIndexDefinition(schema.rows[0]?.create_statement ?? "", index)),
      explainUsesVectorIndex: eligibleIndexes.some((index) => explainLines.some((line) => line.includes(index))),
      explain: explainLines,
    };
    if (production && (!probe.schemaHasVector1024 || probe.eligibleIndexes.length === 0 || probe.vectorIndexDefinitions.length !== probe.eligibleIndexes.length || !probe.explainUsesVectorIndex)) throw new Error("CockroachDB Cloud vector-index proof is incomplete.");
    const receipt = production ? { ...context!, kind: "vector", generatedAt: new Date().toISOString(), probe: { tenantId: smokeProbe!.tenantId, memoryId: smokeProbe!.memoryId, sqlClusterId }, vector: { columnType: probe.schemaHasVector1024 ? "VECTOR(1024)" : "", indexName: "memory_versions_active_embedding_idx", indexColumn: "embedding", indexType: probe.vectorIndexDefinitions.length === 1 ? "VECTOR" : "", ready: probe.vectorIndexDefinitions.length === 1 && indexJob?.status.toLowerCase() === "succeeded", visible: probe.eligibleIndexes.length === 1, explainIndexName: probe.explainUsesVectorIndex ? "memory_versions_active_embedding_idx" : "", jobId: indexJob?.job_id ?? "", jobStatus: indexJob?.status.toLowerCase() ?? "", jobFinishedAt: indexJob?.finished ? new Date(indexJob.finished).toISOString() : "" } } : probe;
    const output = process.argv[2];
    if (output) await atomicWriteJson(output, receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally { await client.end(); }
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
