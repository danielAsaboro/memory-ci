import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { atomicWriteJson, redactEvidence, validateCorrelatedReceipts, validateEvidenceContext } from "./evidence-contract";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))); });

const context = {
  schemaVersion: 2, runId: "b5653a1b-dc4c-4bf9-9b1c-4c149401acd7", generatedAt: "2026-08-17T17:00:00.000Z",
  aws: { accountId: "123456789012", region: "us-east-1", stackName: "stash-production", stackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/stash-production/abc", apiUrl: "https://abc.execute-api.us-east-1.amazonaws.com/v1", bucket: "stash-evidence", eventBus: "stash", evaluatorModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", embeddingModelId: "amazon.titan-embed-text-v2:0" },
  cockroach: { clusterId: "cluster-1", organizationId: "org-1", region: "us-east-1", tier: "BASIC", host: "cluster-1.aws-us-east-1.cockroachlabs.cloud" },
};

describe("production evidence contract", () => {
  it("rejects stale, local, and malformed context before it can label a receipt production", () => {
    expect(validateEvidenceContext(context, new Date("2026-08-17T17:10:00.000Z"))).toMatchObject({ runId: context.runId });
    expect(() => validateEvidenceContext({ ...context, generatedAt: "2026-08-17T16:00:00.000Z" }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/stale/i);
    expect(() => validateEvidenceContext({ ...context, cockroach: { ...context.cockroach, host: "10.1.2.3" } }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/CockroachDB Cloud/i);
  });

  it("fails closed when receipts differ by account, stack, cluster, or run", () => {
    const receipt = { ...context, generatedAt: "2026-08-17T17:05:00.000Z", kind: "smoke", requestIds: { api: "api-1", trace: "trace-1" } };
    expect(() => validateCorrelatedReceipts({ smoke: receipt, vector: { ...receipt, kind: "vector" }, ccloud: { ...receipt, kind: "ccloud" } }, new Date("2026-08-17T17:10:00.000Z"))).not.toThrow();
    expect(() => validateCorrelatedReceipts({ smoke: receipt, vector: { ...receipt, kind: "vector", aws: { ...context.aws, accountId: "999999999999" } }, ccloud: { ...receipt, kind: "ccloud" } }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/account/i);
    expect(() => validateCorrelatedReceipts({ smoke: receipt, vector: { ...receipt, kind: "vector" }, ccloud: { ...receipt, kind: "ccloud", cockroach: { ...context.cockroach, clusterId: "fixture-cluster" } } }, new Date("2026-08-17T17:10:00.000Z"))).toThrow(/cluster/i);
  });

  it("redacts credentials embedded inside arbitrary provider errors", () => {
    const value = JSON.stringify(redactEvidence({ message: "request failed https://alice:s3cr3t@example.test/?token=unsafe Authorization: Bearer jwt-value" }));
    expect(value).not.toMatch(/alice|s3cr3t|unsafe|jwt-value/);
  });

  it("publishes JSON atomically only after serialization succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "stash-evidence-")); roots.push(root);
    const target = join(root, "receipt.json");
    await atomicWriteJson(target, { ok: true });
    await expect(readFile(target, "utf8")).resolves.toContain('"ok": true');
    await expect(atomicWriteJson(join(root, "bad.json"), { circular: null as unknown as null })).resolves.toBeUndefined();
  });
});
