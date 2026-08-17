import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atomicWriteJson, receiptSchema, redactEvidence, validateCorrelatedReceipts, validateEvidenceContext } from "./evidence-contract";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

const context = {
  schemaVersion: 2, runId: "b5653a1b-dc4c-4bf9-9b1c-4c149401acd7", generatedAt: "2026-08-17T17:00:00.000Z",
  aws: { accountId: "123456789012", region: "us-east-1", stackName: "stash-production", stackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/stash-production/abc", apiUrl: "https://abc.execute-api.us-east-1.amazonaws.com/v1", bucket: "stash-evidence", eventBus: "stash", databaseSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:stash/database-abc", evaluatorModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0", embeddingModelId: "amazon.titan-embed-text-v2:0" },
  cockroach: { clusterId: "cluster-1", organizationId: "org-1", region: "us-east-1", tier: "BASIC", host: "cluster-1.aws-us-east-1.cockroachlabs.cloud" },
};

describe("production evidence contract", () => {
  const smoke = { ...context, generatedAt: "2026-08-17T17:05:00.000Z", kind: "aws-smoke", startedAt: "2026-08-17T17:04:00.000Z", requestIds: { api: "api-1", trace: "1-abc" }, health: { status: "ok", requestId: "api-1" }, workspace: { first: { tenantId: "tenant-1", principalId: "principal-1", workspaceName: "Stash", roles: ["admin", "reviewer"] }, retry: { tenantId: "tenant-1", principalId: "principal-1", workspaceName: "Stash", roles: ["admin", "reviewer"] } }, bedrock: { evaluator: { modelId: context.aws.evaluatorModelId, providerRequestId: "eval-1" }, embedding: { modelId: context.aws.embeddingModelId, providerRequestId: "embed-1", dimensions: 1024, digest: "a".repeat(64) } }, s3: { providerRequestId: "s3-1", versionId: "version-1", key: "artifacts/a.json", digest: "b".repeat(64) }, eventBridge: { providerRequestId: "event-1", eventId: "event-id-1" }, probe: { tenantId: "tenant-1", memoryId: "memory-1" } };
  const vector = { ...context, generatedAt: "2026-08-17T17:05:00.000Z", kind: "vector", probe: { tenantId: "tenant-1", memoryId: "memory-1", sqlClusterId: "cluster-1" }, vector: { columnType: "VECTOR(1024)", indexName: "memory_versions_embedding_idx", indexColumn: "embedding", indexType: "VECTOR", ready: true, visible: true, explainIndexName: "memory_versions_embedding_idx", jobId: "job-1", jobStatus: "succeeded", jobFinishedAt: "2026-08-17T17:04:00.000Z" } };
  const ccloud = { ...context, generatedAt: "2026-08-17T17:05:00.000Z", kind: "ccloud", ccloud: { clusterId: "cluster-1", organizationId: "org-1", provider: "AWS", region: "us-east-1", tier: "BASIC", host: "cluster-1.aws-us-east-1.cockroachlabs.cloud", state: "READY" } };
  it("rejects stale, local, and malformed context before it can label a receipt production", () => {
    expect(validateEvidenceContext(context, new Date("2026-08-17T17:10:00.000Z"))).toMatchObject({ runId: context.runId });
    expect(() => validateEvidenceContext({ ...context, generatedAt: "2026-08-17T16:00:00.000Z" }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/stale/i);
    expect(() => validateEvidenceContext({ ...context, cockroach: { ...context.cockroach, host: "10.1.2.3" } }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/CockroachDB Cloud/i);
  });

  it("fails closed when receipts differ by account, stack, cluster, or run", () => {
    expect(() => validateCorrelatedReceipts({ smoke, vector, ccloud }, new Date("2026-08-17T17:10:00.000Z"))).not.toThrow();
    expect(() => validateCorrelatedReceipts({ smoke, vector: { ...vector, aws: { ...context.aws, accountId: "999999999999" } }, ccloud }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/AWS context/i);
    expect(() => validateCorrelatedReceipts({ smoke, vector, ccloud: { ...ccloud, cockroach: { ...context.cockroach, clusterId: "fixture-cluster" } } }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/cluster/i);
  });

  it("rejects a context-only receipt and accepts only complete kind-specific proof payloads", () => {
    expect(() => receiptSchema.parse({ ...context, kind: "aws-smoke" })).toThrow();
    expect(() => receiptSchema.parse(smoke)).not.toThrow();
    expect(() => receiptSchema.parse({ ...vector, vector: { ...vector.vector, indexColumn: "tenant_id" } })).toThrow(/embedding/i);
    expect(() => receiptSchema.parse({ ...smoke, workspace: { ...smoke.workspace, first: { ...smoke.workspace.first, roles: undefined } } })).toThrow(/roles/i);
  });

  it("redacts credentials embedded inside arbitrary provider errors", () => {
    const value = JSON.stringify(redactEvidence({ apiKey: "unsafe", accessKeyId: "AKIAunsafe", sessionToken: "unsafe", message: "request failed https://alice:s3cr3t@example.test/?token=unsafe postgresql://root:pass@db.example.test/stash password=unsafe Authorization: Bearer jwt-value" }));
    expect(value).not.toMatch(/alice|s3cr3t|unsafe|jwt-value|root:pass/);
  });

  it("redacts quoted and escaped JSON credential fragments inside provider error strings", () => {
    const value = JSON.stringify(redactEvidence({ message: '{"apiKey":"unsafe","databaseUrl":"postgresql://u:p@db.example.test/x","nested":"{\\"sessionToken\\":\\"unsafe\\"}"}' }));
    expect(value).not.toContain("unsafe");
    expect(value).not.toContain("u:p");
  });

  it("publishes JSON atomically only after serialization succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "stash-evidence-")); roots.push(root);
    const target = join(root, "receipt.json");
    await atomicWriteJson(target, { ok: true });
    await expect(readFile(target, "utf8")).resolves.toContain('"ok": true');
    await expect(atomicWriteJson(join(root, "bad.json"), { circular: null as unknown as null })).resolves.toBeUndefined();
  });
});
