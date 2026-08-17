import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

const accountId = /^\d{12}$/;
const privateHost = /^(?:localhost|.*\.local|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|::1)$/i;
const credentialKey = /(?:authorization|credential|database.?url|password|secret|token|private.?key)/i;
const queryCredentialKey = /(?:access.?key|authorization|credential|key|password|secret|signature|token)/i;
const embeddedUrl = /\bhttps?:\/\/[^\s"']+/gi;
const bearer = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const jwt = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g;

const awsSchema = z.object({
  accountId: z.string().regex(accountId), region: z.literal("us-east-1"), stackName: z.literal("stash-production"),
  stackId: z.string().regex(/^arn:aws:cloudformation:us-east-1:\d{12}:stack\/stash-production\//),
  apiUrl: z.string().url().regex(/^https:\/\/(?:[a-z0-9-]+\.execute-api\.us-east-1\.amazonaws\.com|api\.trystash\.xyz)\//i),
  bucket: z.string().min(3), eventBus: z.literal("stash"),
  evaluatorModelId: z.literal("anthropic.claude-3-5-sonnet-20241022-v2:0"), embeddingModelId: z.literal("amazon.titan-embed-text-v2:0"),
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
export const receiptSchema = evidenceContextBaseSchema.extend({
  kind: z.enum(["smoke", "vector", "ccloud"]), requestIds: z.object({ api: z.string().min(1), trace: z.string().min(1) }).strict(),
}).strict();
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

export function validateCorrelatedReceipts(value: { smoke: unknown; vector: unknown; ccloud: unknown }, now = new Date()): { smoke: EvidenceReceipt; vector: EvidenceReceipt; ccloud: EvidenceReceipt } {
  const smoke = receiptSchema.parse(value.smoke);
  const vector = receiptSchema.parse(value.vector);
  const ccloud = receiptSchema.parse(value.ccloud);
  if (smoke.kind !== "smoke" || vector.kind !== "vector" || ccloud.kind !== "ccloud") throw new Error("Evidence receipt kinds do not match their expected probes.");
  for (const receipt of [smoke, vector, ccloud]) assertFresh(receipt, now);
  for (const [field, expected, actual] of [
    ["run", smoke.runId, vector.runId], ["run", smoke.runId, ccloud.runId], ["account", smoke.aws.accountId, vector.aws.accountId], ["account", smoke.aws.accountId, ccloud.aws.accountId],
    ["stack", smoke.aws.stackId, vector.aws.stackId], ["stack", smoke.aws.stackId, ccloud.aws.stackId], ["cluster", smoke.cockroach.clusterId, vector.cockroach.clusterId], ["cluster", smoke.cockroach.clusterId, ccloud.cockroach.clusterId],
    ["API URL", smoke.aws.apiUrl, vector.aws.apiUrl], ["bucket", smoke.aws.bucket, ccloud.aws.bucket], ["event bus", smoke.aws.eventBus, ccloud.aws.eventBus],
  ] as const) if (expected !== actual) throw new Error(`Evidence ${field} mismatch.`);
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
  return urls.replace(/\b\d{12}\b/g, "[redacted-account]").replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]").replace(bearer, "[redacted-authorization]").replace(jwt, "[redacted]");
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try { await writeFile(temporary, serialized, { flag: "wx" }); await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
}
