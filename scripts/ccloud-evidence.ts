import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { z } from "zod";

import { atomicWriteJson, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

const exec = promisify(execFile);

// ccloud payloads may carry additional presentation fields; only the final receipt is strict.
const cloudRegionSchema = z.object({ name: z.string().min(1), sql_dns: z.string().min(1), primary: z.boolean().optional() }).passthrough();
const clusterSchema = z.object({ id: z.string().min(1), cloud_provider: z.string(), regions: z.array(cloudRegionSchema).min(1), sql_dns: z.string().min(1), plan: z.string(), state: z.string() }).passthrough();
const organizationSchema = z.object({ id: z.string().min(1) }).passthrough();

export function selectCloudCluster(value: unknown, expectedId: string, organizationId: string) {
  if (!Array.isArray(value)) throw new Error("ccloud must return structured JSON cluster output.");
  const cluster = value.map((item) => clusterSchema.safeParse(item)).find((item) => item.success && item.data.id === expectedId);
  if (!cluster?.success) throw new Error("Requested CockroachDB Cloud cluster was not found.");
  const selected = cluster.data;
  const region = selected.regions.find((item) => item.primary) ?? selected.regions[0];
  if (/fixture|demo|local/i.test(selected.id)) throw new Error("Fixture clusters cannot be used as production evidence.");
  if (selected.cloud_provider.toUpperCase() !== "AWS") throw new Error("CockroachDB Cloud provider must be AWS.");
  if (region.name !== "us-east-1") throw new Error("CockroachDB Cloud region must be us-east-1.");
  if (!["CREATED", "RUNNING", "READY"].includes(selected.state.toUpperCase())) throw new Error("CockroachDB Cloud cluster is not ready.");
  if (!/\.cockroachlabs\.cloud$/i.test(selected.sql_dns) || selected.sql_dns !== region.sql_dns) throw new Error("CockroachDB Cloud SQL host is invalid.");
  return { id: selected.id, organizationId, provider: selected.cloud_provider.toUpperCase(), region: region.name, plan: selected.plan, state: selected.state, sqlHost: selected.sql_dns };
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
  const [organizationValue, clusters] = await Promise.all([commandJson(["organization", "info", "-o", "json", "-q"]), commandJson(["cluster", "list", "-o", "json", "-q"])]);
  const organization = organizationSchema.parse(organizationValue);
  const cluster = selectCloudCluster(clusters, clusterId, organization.id);
  if (cluster.organizationId !== context.cockroach.organizationId || cluster.region !== context.cockroach.region || cluster.plan.toUpperCase() !== context.cockroach.tier || cluster.sqlHost !== context.cockroach.host) throw new Error("CockroachDB Cloud resource does not match the evidence context.");
  await atomicWriteJson(output, { ...context, kind: "ccloud", generatedAt: new Date().toISOString(), ccloud: { clusterId: cluster.id, organizationId: cluster.organizationId, provider: "AWS", region: cluster.region, tier: cluster.plan.toUpperCase(), host: cluster.sqlHost, state: cluster.state.toUpperCase() } });
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
