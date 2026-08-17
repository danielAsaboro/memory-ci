import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";

import { analyzeCandidateWithBedrock, AwsSdkBedrockTransport } from "../src/aws/bedrock";
import { loadAwsConfig } from "../src/aws/config";
import { AwsSdkEventBridgeTransport, publishMemoryEvent } from "../src/aws/eventbridge";
import { AwsSdkS3Transport, putArtifact } from "../src/aws/s3";
import { assertProductionApiBaseUrl } from "./cloud-evidence";
import { atomicWriteJson, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

type WorkspaceResponse = Readonly<{ tenantId: string; principalId: string; workspaceName: string; roles: readonly string[] }>;

export function bootstrapMemoryVersionId(idempotencyKey: string): string {
  const bytes = createHash("sha256").update(`stash-workspace-bootstrap-v1:memory-version:${idempotencyKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateHealthResponse(value: unknown): { status: "ok"; requestId: string } {
  if (!value || typeof value !== "object" || (value as { status?: unknown }).status !== "ok" || typeof (value as { requestId?: unknown }).requestId !== "string") {
    throw new Error("Production health response is missing status=ok or a request ID.");
  }
  return value as { status: "ok"; requestId: string };
}

export function validateWorkspaceResponse(first: unknown, retry: unknown): { first: WorkspaceResponse; retry: WorkspaceResponse } {
  const parse = (value: unknown): WorkspaceResponse => {
    if (!value || typeof value !== "object") throw new Error("Workspace persistence response is missing.");
    const record = value as Record<string, unknown>;
    if (typeof record.tenantId !== "string" || typeof record.principalId !== "string" || typeof record.workspaceName !== "string" || !Array.isArray(record.roles)) throw new Error("Workspace persistence response is malformed.");
    return record as unknown as WorkspaceResponse;
  };
  const one = parse(first);
  const two = parse(retry);
  if (one.tenantId !== two.tenantId || one.principalId !== two.principalId || one.workspaceName !== two.workspaceName) throw new Error("Workspace persistence retry returned a different identity.");
  return { first: one, retry: two };
}

export function validateEmbeddingResponse(value: unknown, providerRequestId: string | undefined, modelId: string): { modelId: string; providerRequestId: string; dimensions: 1024; digest: string } {
  const embedding = value && typeof value === "object" ? (value as { embedding?: unknown }).embedding : undefined;
  if (!Array.isArray(embedding) || embedding.length !== 1024 || embedding.some((item) => typeof item !== "number" || !Number.isFinite(item))) throw new Error("Managed embedding response must contain exactly 1024 finite numeric values.");
  if (!providerRequestId) throw new Error("Managed embedding response is missing a provider request ID.");
  return { modelId, providerRequestId, dimensions: 1024, digest: createHash("sha256").update(JSON.stringify(embedding)).digest("hex") };
}

async function jsonRequest(url: string, init?: RequestInit): Promise<{ body: unknown; headers: Headers }> {
  const response = await fetch(url, init);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error(`Production API returned non-JSON response (${response.status}).`); }
  if (!response.ok) throw new Error(`Production API request failed (${response.status}).`);
  return { body, headers: response.headers };
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: npm run aws:smoke -- <output.json>");
  const contextPath = process.env.STASH_EVIDENCE_CONTEXT_FILE;
  if (!contextPath) throw new Error("STASH_EVIDENCE_CONTEXT_FILE is required for correlated production smoke evidence.");
  const context = validateEvidenceContext(JSON.parse(await readFile(contextPath, "utf8")));
  const config = loadAwsConfig();
  const apiBaseUrl = assertProductionApiBaseUrl(process.env.STASH_API_BASE_URL ?? "");
  const embeddingModelId = process.env.BEDROCK_EMBEDDING_MODEL_ID;
  if (config.AWS_REGION !== context.aws.region || config.BEDROCK_MODEL_ID !== context.aws.evaluatorModelId || embeddingModelId !== context.aws.embeddingModelId || config.EVIDENCE_BUCKET !== context.aws.bucket || config.EVENT_BUS_NAME !== context.aws.eventBus || config.DATABASE_SECRET_ARN !== context.aws.databaseSecretArn || apiBaseUrl !== context.aws.apiUrl) throw new Error("Live AWS configuration does not exactly match the evidence context.");
  const bootstrapKey = process.env.STASH_BOOTSTRAP_KEY;
  if (!bootstrapKey) throw new Error("STASH_BOOTSTRAP_KEY is required for authenticated workspace persistence proof.");
  const startedAt = new Date().toISOString();
  const healthResponse = await jsonRequest(new URL("/health", apiBaseUrl).toString(), { headers: { "x-stash-evidence-run-id": context.runId } });
  const health = validateHealthResponse(healthResponse.body);
  const traceId = healthResponse.headers.get("x-amzn-trace-id")?.match(/(?:^|;)Root=([^;]+)/)?.[1];
  if (!traceId) throw new Error("Health response did not propagate a real X-Amzn-Trace-Id Root value.");
  if (healthResponse.headers.get("x-stash-evidence-run-id") !== context.runId) throw new Error("Health response did not propagate the exact evidence run ID.");
  const idempotencyKey = `cloud-smoke-${randomUUID()}`;
  const workspaceInput = JSON.stringify({ displayName: "Stash production smoke" });
  const request = () => jsonRequest(new URL("workspaces", `${apiBaseUrl}/`).toString(), {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-stash-bootstrap-key": bootstrapKey, "x-stash-evidence-run-id": context.runId }, body: workspaceInput,
  });
  const workspace = validateWorkspaceResponse((await request()).body, (await request()).body);
  const bedrock = await analyzeCandidateWithBedrock({ candidateText: "Refunds above $150 require human review.", trustClass: "authoritative", deterministicFindings: [] }, {
    modelId: config.BEDROCK_MODEL_ID, timeoutMs: config.BEDROCK_TIMEOUT_MS,
    transport: new AwsSdkBedrockTransport(new BedrockRuntimeClient({ region: config.AWS_REGION })),
  });
  if (bedrock.status !== "complete" || !bedrock.providerRequestId) throw new Error("Bedrock smoke did not produce an authenticated provider request ID.");
  const embeddingResponse = await new BedrockRuntimeClient({ region: config.AWS_REGION }).send(new InvokeModelCommand({
    modelId: embeddingModelId, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ inputText: "stash production evidence probe" }),
  }));
  const embedding = validateEmbeddingResponse(JSON.parse(new TextDecoder().decode(embeddingResponse.body)), embeddingResponse.$metadata.requestId, embeddingModelId);
  const artifactBody = JSON.stringify({ schemaVersion: "1", kind: "stash-cloud-smoke", capturedAt: new Date().toISOString(), healthRequestId: health.requestId });
  const artifact = await putArtifact(new AwsSdkS3Transport(new S3Client({ region: config.AWS_REGION })), config.EVIDENCE_BUCKET, {
    body: artifactBody, digest: createHash("sha256").update(artifactBody).digest("hex"), mediaType: "application/json",
  });
  if (!artifact.providerRequestId || !artifact.versionId) throw new Error("S3 smoke did not produce a versioned provider receipt.");
  const event = await publishMemoryEvent(new AwsSdkEventBridgeTransport(new EventBridgeClient({ region: config.AWS_REGION })), config.EVENT_BUS_NAME, {
    id: randomUUID(), tenantId: workspace.first.tenantId, type: "stash.cloud_smoke", aggregateId: workspace.first.tenantId,
    occurredAt: new Date().toISOString(), traceId: randomUUID(), payload: { healthRequestId: health.requestId },
  });
  if (!event.providerRequestId || !event.eventId) throw new Error("EventBridge smoke did not produce a provider receipt.");
  const receipt = { ...context, kind: "aws-smoke", startedAt, generatedAt: new Date().toISOString(), requestIds: { api: health.requestId, trace: traceId }, health, workspace, bedrock: { evaluator: { modelId: bedrock.modelId, providerRequestId: bedrock.providerRequestId }, embedding }, s3: { providerRequestId: artifact.providerRequestId, versionId: artifact.versionId, key: artifact.uri.split("/").slice(3).join("/") }, eventBridge: event, probe: { tenantId: workspace.first.tenantId, memoryId: bootstrapMemoryVersionId(idempotencyKey) } };
  await atomicWriteJson(output, receipt);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
