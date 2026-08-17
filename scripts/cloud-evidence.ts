import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const sensitiveKey = /(?:authorization|credential|database.?url|password|secret|token|private.?key)/i;
const sensitiveQueryKey = /(?:access.?key|authorization|credential|key|password|secret|signature|token)/i;
const accountId = /\b\d{12}\b/g;
const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const bearer = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwt = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g;

type Workspace = Readonly<{ tenantId: string; principalId: string; workspaceName: string }>;
type SmokeReceipt = Readonly<{
  environment: string; apiBaseUrl: string;
  health: { status: string; requestId: string };
  workspace: { first: Workspace; retry: Workspace };
  bedrock: { modelId: string; providerRequestId: string | null };
  s3: { providerRequestId: string | null; versionId: string | null; key: string };
  eventBridge: { providerRequestId: string | null; eventId: string | null };
}>;
type VectorReceipt = Readonly<{
  environment: string; schemaHasVector1024: boolean; eligibleIndexes: readonly string[]; explainUsesVectorIndex: boolean;
}>;
export type ProductionEvidenceInput = Readonly<{
  smoke: SmokeReceipt; vector: VectorReceipt; cloudWatch: { eventId: string | null }; xray: { traceId: string | null };
}>;

/** Removes credentials and personally identifying cloud identity values before a receipt is persisted or printed. */
export function redactEvidence(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactEvidence(item, name)]));
  return value;
}

function redactString(value: string): string {
  let redacted = redactUrl(value);
  redacted = redacted.replace(accountId, "[redacted-account]").replace(email, "[redacted-email]");
  redacted = redacted.replace(bearer, "[redacted-authorization]").replace(jwt, "[redacted]");
  return redacted;
}

function redactUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (url.username || url.password) { url.username = "redacted"; url.password = "redacted"; }
  for (const key of [...url.searchParams.keys()]) if (sensitiveQueryKey.test(key)) url.searchParams.set(key, "[redacted]");
  return url.toString();
}

export function assertProductionApiBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("STASH_API_BASE_URL must be an absolute production HTTPS URL."); }
  if (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("STASH_API_BASE_URL must be a production HTTPS URL, never a local endpoint.");
  if (url.username || url.password || [...url.searchParams.keys()].some((key) => sensitiveQueryKey.test(key))) throw new Error("STASH_API_BASE_URL must not contain credentials.");
  if (!(/\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname) || url.hostname === "api.trystash.xyz")) throw new Error("STASH_API_BASE_URL must be the Stash API Gateway or canonical API domain.");
  return url.toString().replace(/\/$/, "");
}

export function validateWorkspacePersistence(workspace: SmokeReceipt["workspace"]): void {
  const first = workspace.first;
  const retry = workspace.retry;
  if (!first?.tenantId || !first.principalId || !first.workspaceName || first.tenantId !== retry?.tenantId || first.principalId !== retry?.principalId || first.workspaceName !== retry?.workspaceName) throw new Error("Workspace persistence proof is missing or the idempotent retry returned different identifiers.");
}

export function validateProductionEvidence(input: ProductionEvidenceInput): { verified: true } {
  if (input.smoke.environment !== "production") throw new Error("Cloud smoke evidence must be captured against production, not a fixture or local endpoint.");
  assertProductionApiBaseUrl(input.smoke.apiBaseUrl);
  if (input.smoke.health.status !== "ok" || !input.smoke.health.requestId) throw new Error("Production health proof is missing.");
  validateWorkspacePersistence(input.smoke.workspace);
  if (!input.smoke.bedrock.modelId || !input.smoke.bedrock.providerRequestId) throw new Error("Bedrock provider-request proof is missing.");
  if (!input.smoke.s3.providerRequestId || !input.smoke.s3.versionId || !input.smoke.s3.key.startsWith("artifacts/")) throw new Error("S3 evidence-artifact proof is missing.");
  if (!input.smoke.eventBridge.providerRequestId || !input.smoke.eventBridge.eventId) throw new Error("EventBridge delivery proof is missing.");
  if (input.vector.environment !== "cockroach-cloud" || !input.vector.schemaHasVector1024 || !input.vector.explainUsesVectorIndex || input.vector.eligibleIndexes.length === 0) throw new Error("CockroachDB Cloud vector-index proof is missing or is not production evidence.");
  if (!input.cloudWatch.eventId) throw new Error("CloudWatch log proof is missing.");
  if (!input.xray.traceId) throw new Error("X-Ray trace proof is missing.");
  return { verified: true };
}

async function awsJson(args: readonly string[], region: string): Promise<Record<string, unknown>> {
  const { stdout } = await exec("aws", [...args, "--region", region, "--output", "json"], { timeout: 30_000, maxBuffer: 1_000_000 });
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`aws ${args.join(" ")} did not return an object.`);
  return parsed as Record<string, unknown>;
}

async function readReceipt(path: string, label: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error(`${label} receipt is unreadable: ${path}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} receipt must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

export function extractCloudWatchEventId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return null;
  const event = (value as { events: unknown[] }).events.find((item) => item && typeof item === "object" && typeof (item as { eventId?: unknown }).eventId === "string") as { eventId: string } | undefined;
  return event?.eventId ?? null;
}

export function extractXrayTraceId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { TraceSummaries?: unknown }).TraceSummaries)) return null;
  const trace = (value as { TraceSummaries: unknown[] }).TraceSummaries.find((item) => item && typeof item === "object" && typeof (item as { Id?: unknown }).Id === "string") as { Id: string } | undefined;
  return trace?.Id ?? null;
}

async function main(): Promise<void> {
  const output = process.argv[2];
  const smokePath = process.env.STASH_SMOKE_EVIDENCE_FILE;
  const vectorPath = process.env.STASH_VECTOR_EVIDENCE_FILE;
  const region = process.env.AWS_REGION ?? "us-east-1";
  const stackName = process.env.STASH_STACK_NAME ?? "stash-production";
  if (!output) throw new Error("Usage: npm run cloud:evidence -- <output.json>");
  if (!smokePath || !vectorPath) throw new Error("STASH_SMOKE_EVIDENCE_FILE and STASH_VECTOR_EVIDENCE_FILE are required; cloud evidence never substitutes local fixtures.");
  const [smoke, vector, identity, stack] = await Promise.all([readReceipt(smokePath, "AWS smoke"), readReceipt(vectorPath, "Vector"), awsJson(["sts", "get-caller-identity"], region), awsJson(["cloudformation", "describe-stacks", "--stack-name", stackName], region)]);
  const stackRow = Array.isArray(stack.Stacks) ? stack.Stacks[0] as Record<string, unknown> | undefined : undefined;
  const status = typeof stackRow?.StackStatus === "string" ? stackRow.StackStatus : "";
  if (status !== "CREATE_COMPLETE" && status !== "UPDATE_COMPLETE") throw new Error(`Stack ${stackName} is not complete.`);
  const startTime = new Date(Date.now() - 15 * 60_000).toISOString();
  const [logs, traces] = await Promise.all([
    awsJson(["logs", "filter-log-events", "--log-group-name", "/aws/lambda/stash-api", "--start-time", String(Date.parse(startTime)), "--max-items", "20"], region),
    awsJson(["xray", "get-trace-summaries", "--start-time", startTime, "--end-time", new Date().toISOString()], region),
  ]);
  const input: ProductionEvidenceInput = { smoke: smoke as unknown as SmokeReceipt, vector: vector as unknown as VectorReceipt, cloudWatch: { eventId: extractCloudWatchEventId(logs) }, xray: { traceId: extractXrayTraceId(traces) } };
  validateProductionEvidence(input);
  const evidence = redactEvidence({ schemaVersion: "1", verified: true, capturedAt: new Date().toISOString(), region, stack: { name: stackName, status }, awsIdentity: { account: identity.Account, arn: identity.Arn, providerRequestId: identity.ResponseMetadata }, smoke, vector, cloudWatch: input.cloudWatch, xray: input.xray });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${redactEvidence(error instanceof Error ? error.message : "Cloud evidence failed.")}\n`); process.exitCode = 1; });
