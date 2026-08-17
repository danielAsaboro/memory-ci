import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import { atomicWriteJson, redactEvidence, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

const exec = promisify(execFile);

const clusterSchema = z.object({ id: z.string().min(1), provider: z.string(), region: z.string(), plan: z.string(), state: z.string(), sqlHost: z.string().min(1) }).passthrough();

export function selectCloudCluster(value: unknown, expectedId: string) {
  if (!value || typeof value !== "object") throw new Error("ccloud must return structured JSON cluster output.");
  const record = value as Record<string, unknown>;
  const clusters = Array.isArray(record.clusters) ? record.clusters : null;
  if (!clusters) throw new Error("ccloud must return structured JSON cluster output.");
  const cluster = clusters.map((item) => clusterSchema.safeParse(item)).find((item) => item.success && item.data.id === expectedId);
  if (!cluster?.success) throw new Error("Requested CockroachDB Cloud cluster was not found.");
  const selected = cluster.data;
  if (/fixture|demo|local/i.test(selected.id)) throw new Error("Fixture clusters cannot be used as production evidence.");
  if (selected.provider.toUpperCase() !== "AWS") throw new Error("CockroachDB Cloud provider must be AWS.");
  if (selected.region !== "us-east-1") throw new Error("CockroachDB Cloud region must be us-east-1.");
  if (!/ACTIVE|READY/i.test(selected.state)) throw new Error("CockroachDB Cloud cluster is not ready.");
  if (!/\.cockroachlabs\.cloud$/i.test(selected.sqlHost)) throw new Error("CockroachDB Cloud SQL host is invalid.");
  return selected;
}

async function commandJson(args: string[]): Promise<unknown> {
  const { stdout } = await exec("ccloud", args, { timeout: 30_000, maxBuffer: 1_000_000 });
  try { return JSON.parse(stdout); } catch { throw new Error("ccloud returned non-JSON output."); }
}

async function main(): Promise<void> {
  const output = process.argv[2]; const contextPath = process.env.STASH_EVIDENCE_CONTEXT_FILE; const clusterId = process.env.COCKROACH_CLUSTER_ID;
  if (!output || !contextPath || !clusterId) throw new Error("Usage requires output, STASH_EVIDENCE_CONTEXT_FILE, and COCKROACH_CLUSTER_ID.");
  const context = validateEvidenceContext(JSON.parse(await readFile(contextPath, "utf8")));
  if (context.cockroach.clusterId !== clusterId) throw new Error("CockroachDB Cloud cluster does not match the evidence context.");
  const [identity, clusters] = await Promise.all([commandJson(["auth", "whoami", "-o", "json"]), commandJson(["cluster", "list", "-o", "json"])]);
  const cluster = selectCloudCluster(clusters, clusterId);
  if (cluster.region !== context.cockroach.region || cluster.plan.toUpperCase() !== context.cockroach.tier || cluster.sqlHost !== context.cockroach.host) throw new Error("CockroachDB Cloud resource does not match the evidence context.");
  await atomicWriteJson(output, { ...context, kind: "ccloud", generatedAt: new Date().toISOString(), requestIds: { api: `ccloud:${cluster.id}`, trace: `ccloud:${cluster.state}` }, ccloud: redactEvidence({ identity, cluster }) });
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
