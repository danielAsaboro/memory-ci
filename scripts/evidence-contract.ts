import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

const accountId = /^\d{12}$/;
const privateHost = /^(?:localhost|.*\.local|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|::1)$/i;
const credentialKey = /(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|session[_-]?token|authorization|credential|database[_-]?url|connection[_-]?string|password|secret|token|private[_-]?key)/i;
const queryCredentialKey = /(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|session[_-]?token|authorization|credential|key|password|secret|signature|token)/i;
const embeddedUrl = /\b(?:https?|postgres(?:ql)?):\/\/[^\s"']+/gi;
const bearer = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwt = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g;

const awsSchema = z.object({
  accountId: z.string().regex(accountId), region: z.literal("us-east-1"), stackName: z.literal("stash-production"),
  stackId: z.string().regex(/^arn:aws:cloudformation:us-east-1:\d{12}:stack\/stash-production\//),
  apiUrl: z.string().url().regex(/^https:\/\/(?:[a-z0-9-]+\.execute-api\.us-east-1\.amazonaws\.com|api\.trystash\.xyz)\//i),
  bucket: z.string().min(3), eventBus: z.literal("stash"),
  databaseSecretArn: z.string().regex(/^arn:aws:secretsmanager:us-east-1:\d{12}:secret:stash\//),
  evaluatorModelId: z.literal("us.anthropic.claude-haiku-4-5-20251001-v1:0"), embeddingModelId: z.literal("amazon.titan-embed-text-v2:0"),
}).strict();
const cockroachSchema = z.object({
  clusterId: z.string().min(1).refine((value) => !/fixture|demo|local/i.test(value)), organizationId: z.string().min(1), region: z.literal("us-east-1"),
  tier: z.enum(["BASIC", "STANDARD", "ADVANCED", "SERVERLESS"]), host: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (privateHost.test(value.host) || !/\.cockroachlabs\.cloud$/i.test(value.host)) context.addIssue({ code: "custom", message: "CockroachDB Cloud host must be a public cockroachlabs.cloud hostname." });
});
const evidenceContextBaseSchema = z.object({
  schemaVersion: z.literal(2), runId: z.string().uuid(), generatedAt: z.string().datetime(), aws: awsSchema, cockroach: cockroachSchema,
});
export const evidenceContextSchema = evidenceContextBaseSchema.strict();
const smokeReceiptSchema = evidenceContextBaseSchema.extend({
  kind: z.literal("aws-smoke"), startedAt: z.string().datetime(), requestIds: z.object({ api: z.string().min(1), trace: z.string().min(1) }).strict(),
  health: z.object({ status: z.literal("ok"), requestId: z.string().min(1) }).strict(),
  workspace: z.object({ first: z.object({ tenantId: z.string().min(1), principalId: z.string().min(1), workspaceName: z.string().min(1), roles: z.array(z.string().min(1)).min(1) }).strict(), retry: z.object({ tenantId: z.string().min(1), principalId: z.string().min(1), workspaceName: z.string().min(1), roles: z.array(z.string().min(1)).min(1) }).strict() }).strict(),
  bedrock: z.object({ evaluator: z.object({ modelId: z.literal("us.anthropic.claude-haiku-4-5-20251001-v1:0"), providerRequestId: z.string().min(1) }).strict(), embedding: z.object({ modelId: z.literal("amazon.titan-embed-text-v2:0"), providerRequestId: z.string().min(1), dimensions: z.literal(1024), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict(),
  s3: z.object({ providerRequestId: z.string().min(1), versionId: z.string().min(1), key: z.string().regex(/^artifacts\//), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), eventBridge: z.object({ providerRequestId: z.string().min(1), eventId: z.string().min(1) }).strict(), probe: z.object({ tenantId: z.string().min(1), memoryId: z.string().min(1) }).strict(),
}).strict();
const vectorReceiptSchema = evidenceContextBaseSchema.extend({
  kind: z.literal("vector"), probe: z.object({ tenantId: z.string().min(1), memoryId: z.string().min(1), sqlClusterId: z.string().min(1) }).strict(), vector: z.object({ columnType: z.literal("VECTOR(1024)"), indexName: z.string().min(1), indexColumn: z.literal("embedding"), indexType: z.literal("VECTOR"), ready: z.literal(true), visible: z.literal(true), explainIndexName: z.string().min(1), jobId: z.string().min(1), jobStatus: z.literal("succeeded"), jobFinishedAt: z.string().datetime() }).strict(),
}).strict();
const ccloudReceiptSchema = evidenceContextBaseSchema.extend({
  kind: z.literal("ccloud"), ccloud: z.object({ clusterId: z.string().min(1), organizationId: z.string().min(1), provider: z.literal("AWS"), region: z.literal("us-east-1"), tier: z.enum(["BASIC", "STANDARD"]), host: z.string().regex(/\.cockroachlabs\.cloud$/), state: z.enum(["CREATED", "RUNNING", "READY"]) }).strict(),
}).strict();
export const receiptSchema = z.discriminatedUnion("kind", [smokeReceiptSchema, vectorReceiptSchema, ccloudReceiptSchema]);
export type EvidenceContext = z.infer<typeof evidenceContextSchema>;
export type EvidenceReceipt = z.infer<typeof receiptSchema>;

export function validateEvidenceContext(value: unknown, now = new Date()): EvidenceContext {
  const context = evidenceContextSchema.parse(value);
  assertFresh(context, now);
  return context;
}

function assertFresh(context: Pick<EvidenceContext, "generatedAt">, now: Date): void {
  const age = now.getTime() - Date.parse(context.generatedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > 15 * 60_000) throw new Error("Evidence context is stale or outside the allowed freshness window.");
}

export function validateCorrelatedReceipts(value: { smoke: unknown; vector: unknown; ccloud: unknown }, now = new Date()) {
  const smoke = receiptSchema.parse(value.smoke);
  const vector = receiptSchema.parse(value.vector);
  const ccloud = receiptSchema.parse(value.ccloud);
  if (smoke.kind !== "aws-smoke" || vector.kind !== "vector" || ccloud.kind !== "ccloud") throw new Error("Evidence receipt kinds do not match their expected probes.");
  for (const receipt of [smoke, vector, ccloud]) assertFresh(receipt, now);
  const started = Date.parse(smoke.startedAt); const finished = Date.parse(smoke.generatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || started > finished || finished - started > 15 * 60_000) throw new Error("Smoke receipt time window is invalid or exceeds the allowed duration.");
  for (const [field, expected, actual] of [
    ["run", smoke.runId, vector.runId], ["run", smoke.runId, ccloud.runId], ["AWS context", JSON.stringify(smoke.aws), JSON.stringify(vector.aws)], ["AWS context", JSON.stringify(smoke.aws), JSON.stringify(ccloud.aws)],
    ["Cockroach context", JSON.stringify(smoke.cockroach), JSON.stringify(vector.cockroach)], ["Cockroach context", JSON.stringify(smoke.cockroach), JSON.stringify(ccloud.cockroach)],
  ] as const) if (expected !== actual) throw new Error(`Evidence ${field} mismatch.`);
  if (smoke.health.requestId !== smoke.requestIds.api || smoke.workspace.first.tenantId !== smoke.workspace.retry.tenantId || smoke.workspace.first.principalId !== smoke.workspace.retry.principalId || JSON.stringify(smoke.workspace.first.roles) !== JSON.stringify(smoke.workspace.retry.roles) || smoke.probe.tenantId !== vector.probe.tenantId || smoke.probe.memoryId !== vector.probe.memoryId || vector.probe.sqlClusterId !== smoke.cockroach.clusterId || vector.vector.indexName !== vector.vector.explainIndexName || ccloud.ccloud.clusterId !== smoke.cockroach.clusterId || ccloud.ccloud.organizationId !== smoke.cockroach.organizationId || ccloud.ccloud.tier !== smoke.cockroach.tier || ccloud.ccloud.host !== smoke.cockroach.host || ccloud.ccloud.provider !== "AWS" || ccloud.ccloud.region !== smoke.cockroach.region) throw new Error("Receipt semantic proof is incomplete or inconsistent.");
  return { smoke, vector, ccloud };
}

export function redactEvidence(value: unknown, key = ""): unknown {
  if (credentialKey.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactEvidence(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactEvidence(item, name)]));
  return value;
}

export function safeErrorMessage(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error ? String(redactEvidence(String((error as { message: unknown }).message))) : "Operation failed.";
}

function redactString(value: string): string {
  const urls = value.replace(embeddedUrl, (raw) => {
    try {
      const url = new URL(raw); url.username = url.username ? "redacted" : ""; url.password = url.password ? "redacted" : "";
      for (const key of [...url.searchParams.keys()]) if (queryCredentialKey.test(key)) url.searchParams.set(key, "[redacted]");
      return url.toString();
    } catch { return raw; }
  });
  return urls.replace(/((?:\\?"|\b)(?:api[_-]?key|access[_-]?key(?:[_-]?id)?|secret[_-]?access[_-]?key|session[_-]?token|database[_-]?url|connection[_-]?string|password|token)(?:\\?"|\b)\s*[:=]\s*(?:\\?")?)([^\s,}&\\"]+)/gi, (_match, prefix: string) => `${prefix}[redacted]`).replace(/\b\d{12}\b/g, "[redacted-account]").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]").replace(bearer, "[redacted-authorization]").replace(jwt, "[redacted]");
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try { await writeFile(temporary, serialized, { flag: "wx" }); await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
