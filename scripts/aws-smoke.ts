import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";

import { analyzeCandidateWithBedrock, AwsSdkBedrockTransport } from "../src/aws/bedrock";
import { loadAwsConfig } from "../src/aws/config";
import { AwsSdkEventBridgeTransport, publishMemoryEvent } from "../src/aws/eventbridge";
import { AwsSdkS3Transport, putArtifact } from "../src/aws/s3";
import { assertProductionApiBaseUrl, redactEvidence } from "./cloud-evidence";

type WorkspaceResponse = Readonly<{ tenantId: string; principalId: string; workspaceName: string; roles: readonly string[] }>;

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

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error(`Production API returned non-JSON response (${response.status}).`); }
  if (!response.ok) throw new Error(`Production API request failed (${response.status}).`);
  return body;
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: npm run aws:smoke -- <output.json>");
  const config = loadAwsConfig();
  const apiBaseUrl = assertProductionApiBaseUrl(process.env.STASH_API_BASE_URL ?? "");
  const bootstrapKey = process.env.STASH_BOOTSTRAP_KEY;
  if (!bootstrapKey) throw new Error("STASH_BOOTSTRAP_KEY is required for authenticated workspace persistence proof.");
  const health = validateHealthResponse(await jsonRequest(new URL("/health", apiBaseUrl).toString()));
  const idempotencyKey = `cloud-smoke-${randomUUID()}`;
  const workspaceInput = JSON.stringify({ displayName: "Stash production smoke" });
  const request = () => jsonRequest(new URL("workspaces", `${apiBaseUrl}/`).toString(), {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-stash-bootstrap-key": bootstrapKey }, body: workspaceInput,
  });
  const workspace = validateWorkspaceResponse(await request(), await request());
  const bedrock = await analyzeCandidateWithBedrock({ candidateText: "Refunds above $150 require human review.", trustClass: "authoritative", deterministicFindings: [] }, {
    modelId: config.BEDROCK_MODEL_ID, timeoutMs: config.BEDROCK_TIMEOUT_MS,
    transport: new AwsSdkBedrockTransport(new BedrockRuntimeClient({ region: config.AWS_REGION })),
  });
  if (bedrock.status !== "complete" || !bedrock.providerRequestId) throw new Error("Bedrock smoke did not produce an authenticated provider request ID.");
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
  const receipt = redactEvidence({ schemaVersion: "1", verified: true, environment: "production", capturedAt: new Date().toISOString(), apiBaseUrl, health, workspace, bedrock: { modelId: bedrock.modelId, providerRequestId: bedrock.providerRequestId }, s3: { providerRequestId: artifact.providerRequestId, versionId: artifact.versionId, key: artifact.uri.split("/").slice(3).join("/") }, eventBridge: event });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${redactEvidence(error instanceof Error ? error.message : "AWS smoke failed.")}\n`); process.exitCode = 1; });
