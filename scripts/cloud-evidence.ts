import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { atomicWriteJson, redactEvidence, receiptSchema, safeErrorMessage, validateCorrelatedReceipts } from "./evidence-contract";

const exec = promisify(execFile);
export { redactEvidence } from "./evidence-contract";

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

const sensitiveQueryKey = /(?:access.?key|authorization|credential|key|password|secret|signature|token)/i;

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
  try { return receiptSchema.parse(parsed); } catch { throw new Error(`${label} receipt is invalid or incomplete.`); }
}

export function extractCloudWatchEventId(value: unknown, requiredRequestId?: string, requiredRunId?: string, requiredTraceId?: string, startedAt?: string, generatedAt?: string): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return null;
  const event = (value as { events: unknown[] }).events.find((item) => {
    if (!item || typeof item !== "object" || typeof (item as { eventId?: unknown }).eventId !== "string" || typeof (item as { message?: unknown }).message !== "string") return false;
    const timestamp = (item as { timestamp?: unknown }).timestamp;
    if (startedAt && generatedAt && (typeof timestamp !== "number" || timestamp < Date.parse(startedAt) || timestamp > Date.parse(generatedAt) + 120_000)) return false;
    try {
      const message: unknown = JSON.parse((item as { message: string }).message);
      return Boolean(message && typeof message === "object" && (message as { kind?: unknown }).kind === "stash-api-request" && (!requiredRequestId || (message as { requestId?: unknown }).requestId === requiredRequestId) && (!requiredRunId || (message as { runId?: unknown }).runId === requiredRunId) && (!requiredTraceId || (message as { traceId?: unknown }).traceId === requiredTraceId));
    } catch { return false; }
  }) as { eventId: string } | undefined;
  return event?.eventId ?? null;
}

export function extractXrayTraceId(value: unknown): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { TraceSummaries?: unknown }).TraceSummaries)) return null;
  const trace = (value as { TraceSummaries: unknown[] }).TraceSummaries.find((item) => item && typeof item === "object" && typeof (item as { Id?: unknown }).Id === "string") as { Id: string } | undefined;
  return trace?.Id ?? null;
}

export function extractObservedTraceId(value: unknown, traceId: string, startedAt: string, generatedAt: string): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { Traces?: unknown }).Traces)) return null;
  const start = Date.parse(startedAt) / 1000; const end = (Date.parse(generatedAt) + 120_000) / 1000;
  const trace = (value as { Traces: unknown[] }).Traces.find((item) => {
    if (!item || typeof item !== "object" || (item as { Id?: unknown }).Id !== traceId || !Array.isArray((item as { Segments?: unknown }).Segments)) return false;
    return (item as { Segments: unknown[] }).Segments.some((segment) => {
      if (!segment || typeof segment !== "object" || typeof (segment as { Document?: unknown }).Document !== "string") return false;
      try { const document: unknown = JSON.parse((segment as { Document: string }).Document); return Boolean(document && typeof document === "object" && typeof (document as { start_time?: unknown }).start_time === "number" && typeof (document as { end_time?: unknown }).end_time === "number" && (document as { start_time: number }).start_time >= start && (document as { end_time: number }).end_time <= end); } catch { return false; }
    });
  });
  return trace ? traceId : null;
}

export function hasObservedBedrockInvocation(value: unknown, smoke: { aws: { accountId: string; region: string }; runId: string; bedrock: { evaluator: { modelId: string; providerRequestId: string }; embedding: { modelId: string; providerRequestId: string } } }): boolean {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return false;
  const required = [smoke.bedrock.evaluator, smoke.bedrock.embedding];
  return required.every((expected) => (value as { events: unknown[] }).events.some((event) => {
    try {
      const record: unknown = JSON.parse((event as { message: string }).message); const item = record as { schemaType?: unknown; schemaVersion?: unknown; accountId?: unknown; region?: unknown; operation?: unknown; modelId?: unknown; requestId?: unknown; requestMetadata?: unknown };
      const metadata = item.requestMetadata as Record<string, unknown> | undefined;
      return item.schemaType === "ModelInvocationLog" && item.schemaVersion === "1.0" && item.accountId === smoke.aws.accountId && item.region === smoke.aws.region && item.operation === "InvokeModel" && item.modelId === expected.modelId && item.requestId === expected.providerRequestId && metadata?.runId === smoke.runId && metadata?.purpose === "stash-production-smoke";
    } catch { return false; }
  }));
}

export function validateObservedArtifact(head: { VersionId?: string; Metadata?: Record<string, string>; ETag?: string }, body: Uint8Array, smoke: { runId: string; s3: { versionId: string; digest: string; etag: string } }): { etag: string } {
  const digest = createHash("sha256").update(body).digest("hex");
  if (!head.ETag || head.ETag !== smoke.s3.etag || head.VersionId !== smoke.s3.versionId || head.Metadata?.["content-sha256"] !== smoke.s3.digest || digest !== smoke.s3.digest) throw new Error("S3 observation does not exactly match the versioned smoke artifact.");
  try { if (JSON.parse(Buffer.from(body).toString("utf8")).runId !== smoke.runId) throw new Error("mismatch"); } catch { throw new Error("S3 artifact does not contain the exact evidence run ID."); }
  return { etag: head.ETag };
}

export function extractObservedServiceEvent(value: unknown, smoke: { runId: string; startedAt: string; generatedAt: string; aws: { accountId: string; region: string; bucket: string }; s3: { key: string; versionId: string; digest: string; etag: string }; eventBridge: { eventId: string }; bedrock: { evaluator: { modelId: string; providerRequestId: string }; embedding: { modelId: string; providerRequestId: string; dimensions: number } } }): string | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { events?: unknown }).events)) return null;
  const match = (value as { events: unknown[] }).events.find((event) => {
    if (!event || typeof event !== "object" || typeof (event as { eventId?: unknown }).eventId !== "string" || typeof (event as { message?: unknown }).message !== "string") return false;
    try {
      const envelope: unknown = JSON.parse((event as { message: string }).message);
      const record = envelope as { id?: unknown; source?: unknown; "detail-type"?: unknown; account?: unknown; region?: unknown; time?: unknown; detail?: unknown };
      const time = typeof record.time === "string" ? Date.parse(record.time) : NaN;
      if (record.id !== smoke.eventBridge.eventId || record.source !== "memory-ci" || record["detail-type"] !== "stash.cloud_smoke" || record.account !== smoke.aws.accountId || record.region !== smoke.aws.region || !Number.isFinite(time) || time < Date.parse(smoke.startedAt) || time > Date.parse(smoke.generatedAt) + 120_000) return false;
      const detail = envelope && typeof envelope === "object" && typeof record.detail === "object" ? record.detail as { payload?: unknown } : null;
      const payload = detail?.payload as Record<string, unknown> | undefined;
      const evaluator = payload?.evaluator as Record<string, unknown> | undefined; const embedding = payload?.embedding as Record<string, unknown> | undefined;
      const s3 = payload?.s3 as Record<string, unknown> | undefined;
      return payload?.runId === smoke.runId && s3?.bucket === smoke.aws.bucket && s3?.key === smoke.s3.key && s3?.versionId === smoke.s3.versionId && s3?.digest === smoke.s3.digest && s3?.etag === smoke.s3.etag && evaluator?.modelId === smoke.bedrock.evaluator.modelId && evaluator?.providerRequestId === smoke.bedrock.evaluator.providerRequestId && embedding?.modelId === smoke.bedrock.embedding.modelId && embedding?.providerRequestId === smoke.bedrock.embedding.providerRequestId && embedding?.dimensions === 1024;
    } catch { return false; }
  }) as { eventId: string } | undefined;
  return match?.eventId ?? null;
}

async function main(): Promise<void> {
  const output = process.argv[2];
  const smokePath = process.env.STASH_SMOKE_EVIDENCE_FILE;
  const vectorPath = process.env.STASH_VECTOR_EVIDENCE_FILE;
  const ccloudPath = process.env.STASH_CCLOUD_EVIDENCE_FILE;
  const region = process.env.AWS_REGION ?? "us-east-1";
  const stackName = process.env.STASH_STACK_NAME ?? "stash-production";
  if (!output) throw new Error("Usage: npm run cloud:evidence -- <output.json>");
  if (!smokePath || !vectorPath || !ccloudPath) throw new Error("Smoke, vector, and ccloud receipts are required; cloud evidence never substitutes local fixtures.");
  const [smoke, vector, ccloud, identity, stack] = await Promise.all([readReceipt(smokePath, "AWS smoke"), readReceipt(vectorPath, "Vector"), readReceipt(ccloudPath, "ccloud"), awsJson(["sts", "get-caller-identity"], region), awsJson(["cloudformation", "describe-stacks", "--stack-name", stackName], region)]);
  const correlated = validateCorrelatedReceipts({ smoke, vector, ccloud });
  const stackRow = Array.isArray(stack.Stacks) ? stack.Stacks[0] as Record<string, unknown> | undefined : undefined;
  const status = typeof stackRow?.StackStatus === "string" ? stackRow.StackStatus : "";
  if (status !== "CREATE_COMPLETE" && status !== "UPDATE_COMPLETE") throw new Error(`Stack ${stackName} is not complete.`);
  const outputs = Object.fromEntries((Array.isArray(stackRow?.Outputs) ? stackRow.Outputs : []).flatMap((item) => item && typeof item === "object" && typeof (item as { OutputKey?: unknown }).OutputKey === "string" && typeof (item as { OutputValue?: unknown }).OutputValue === "string" ? [[(item as { OutputKey: string }).OutputKey, (item as { OutputValue: string }).OutputValue]] : []));
  const parameters = Object.fromEntries((Array.isArray(stackRow?.Parameters) ? stackRow.Parameters : []).flatMap((item) => item && typeof item === "object" && typeof (item as { ParameterKey?: unknown }).ParameterKey === "string" && typeof (item as { ParameterValue?: unknown }).ParameterValue === "string" ? [[(item as { ParameterKey: string }).ParameterKey, (item as { ParameterValue: string }).ParameterValue]] : []));
  if (identity.Account !== correlated.smoke.aws.accountId || stackRow?.StackId !== correlated.smoke.aws.stackId || stackRow?.StackName !== correlated.smoke.aws.stackName || outputs.ApiUrl !== correlated.smoke.aws.apiUrl || outputs.EvidenceBucketName !== correlated.smoke.aws.bucket || outputs.EventBusName !== correlated.smoke.aws.eventBus || parameters.DatabaseSecretArn !== correlated.smoke.aws.databaseSecretArn || parameters.BedrockModelId !== correlated.smoke.aws.evaluatorModelId || parameters.BedrockEmbeddingModelId !== correlated.smoke.aws.embeddingModelId) throw new Error("Independently observed CloudFormation or STS identity does not exactly match production evidence context.");
  const [logs, traces] = await Promise.all([
    awsJson(["logs", "filter-log-events", "--log-group-name", "/aws/lambda/stash-api", "--start-time", String(Date.parse(correlated.smoke.startedAt)), "--filter-pattern", `{ $.requestId = "${correlated.smoke.requestIds.api}" && $.runId = "${correlated.smoke.runId}" }`, "--max-items", "20"], region),
    awsJson(["xray", "batch-get-traces", "--trace-ids", correlated.smoke.requestIds.trace], region),
  ]);
  const s3 = new S3Client({ region });
  const [head, object, serviceEvents, bedrockLogs] = await Promise.all([
    s3.send(new HeadObjectCommand({ Bucket: correlated.smoke.aws.bucket, Key: correlated.smoke.s3.key, VersionId: correlated.smoke.s3.versionId })),
    s3.send(new GetObjectCommand({ Bucket: correlated.smoke.aws.bucket, Key: correlated.smoke.s3.key, VersionId: correlated.smoke.s3.versionId })),
    awsJson(["logs", "filter-log-events", "--log-group-name", "/aws/events/stash-production-observations", "--start-time", String(Date.parse(correlated.smoke.startedAt)), "--filter-pattern", correlated.smoke.runId, "--max-items", "20"], region),
    awsJson(["logs", "filter-log-events", "--log-group-name", "/aws/bedrock/stash-production-invocations", "--start-time", String(Date.parse(correlated.smoke.startedAt)), "--filter-pattern", correlated.smoke.runId, "--max-items", "50"], region),
  ]);
  if (!object.Body) throw new Error("S3 observation returned no artifact body.");
  const observedArtifact = validateObservedArtifact(head, await object.Body.transformToByteArray(), correlated.smoke);
  const cloudWatch = { eventId: extractCloudWatchEventId(logs, correlated.smoke.requestIds.api, correlated.smoke.runId, correlated.smoke.requestIds.trace, correlated.smoke.startedAt, correlated.smoke.generatedAt) };
  const xray = { traceId: extractObservedTraceId(traces, correlated.smoke.requestIds.trace, correlated.smoke.startedAt, correlated.smoke.generatedAt) };
  if (!cloudWatch.eventId) throw new Error("CloudWatch result does not contain the exact smoke request ID.");
  if (!xray.traceId || xray.traceId !== correlated.smoke.requestIds.trace) throw new Error("X-Ray result does not contain the exact smoke trace ID.");
  const serviceEventId = extractObservedServiceEvent(serviceEvents, correlated.smoke);
  if (!serviceEventId) throw new Error("Stack-owned EventBridge observation does not exactly match event and Bedrock provider proofs.");
  if (!hasObservedBedrockInvocation(bedrockLogs, correlated.smoke)) throw new Error("Bedrock-owned invocation logs do not exactly match both smoke provider requests.");
  const evidence = redactEvidence({ schemaVersion: 2, verified: true, generatedAt: new Date().toISOString(), region, stack: { name: stackName, status }, awsIdentity: { account: identity.Account, arn: identity.Arn }, smoke, vector, ccloud, cloudWatch, xray, s3: observedArtifact, serviceEventId });
  await atomicWriteJson(output, evidence);
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
