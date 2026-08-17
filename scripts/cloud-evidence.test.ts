import { describe, expect, it } from "vitest";

import {
  assertProductionApiBaseUrl,
  extractCloudWatchEventId,
  extractXrayTraceId,
  redactEvidence,
  validateProductionEvidence,
  validateWorkspacePersistence,
  validateObservedArtifact,
  extractObservedServiceEvent,
  extractObservedTraceId,
} from "./cloud-evidence";
import { createHash } from "node:crypto";

describe("production cloud evidence", () => {
  it("reads only named CloudWatch and X-Ray proof IDs, never an arbitrary response string", () => {
    expect(extractCloudWatchEventId({ events: [{ logStreamName: "stream-name", message: JSON.stringify({ kind: "stash-api-request", requestId: "request-1", runId: "run-1" }), eventId: "log-event-1" }], }, "request-1", "run-1")).toBe("log-event-1");
    expect(extractXrayTraceId({ TraceSummaries: [{ Duration: 1, Id: "1-abcdef-trace" }] })).toBe("1-abcdef-trace");
    expect(extractCloudWatchEventId({ events: [{ logStreamName: "stream-name" }] })).toBeNull();
    expect(extractXrayTraceId({ TraceSummaries: [{ Summary: "not-a-trace-id" }] })).toBeNull();
  });

  it("redacts account IDs, emails, credentials, and credential-bearing URLs recursively", () => {
    const receipt = redactEvidence({
      account: "123456789012",
      arn: "arn:aws:iam::123456789012:user/reviewer@example.com",
      token: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      endpoint: "https://admin:password@api.example.test/v1?token=unsafe",
      nested: ["Authorization: Bearer unsafe-token", "safe-request-id"],
    });

    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toMatch(/123456789012|reviewer@example\.com|unsafe-token|admin:password|eyJhbGci/);
    expect(receipt).toMatchObject({ account: "[redacted-account]", token: "[redacted]" });
  });

  it("rejects local, insecure, and credential-bearing API endpoints", () => {
    expect(() => assertProductionApiBaseUrl("http://localhost:3000")).toThrow(/production HTTPS/i);
    expect(() => assertProductionApiBaseUrl("https://token@api.example.test/v1")).toThrow(/credentials/i);
    expect(assertProductionApiBaseUrl("https://abc.execute-api.us-east-1.amazonaws.com/v1")).toBe("https://abc.execute-api.us-east-1.amazonaws.com/v1");
  });

  it("rejects a workspace receipt that does not prove idempotent production persistence", () => {
    expect(() => validateWorkspacePersistence({
      first: { tenantId: "tenant-a", principalId: "principal-a", workspaceName: "Stash smoke" },
      retry: { tenantId: "tenant-b", principalId: "principal-a", workspaceName: "Stash smoke" },
    })).toThrow(/persistence/i);
  });

  it("fails closed when a required production proof is absent or local", () => {
    expect(() => validateProductionEvidence({
      smoke: {
        environment: "production", apiBaseUrl: "https://abc.execute-api.us-east-1.amazonaws.com/v1",
        health: { status: "ok", requestId: "health-1" },
        workspace: { first: { tenantId: "tenant-a", principalId: "principal-a", workspaceName: "Stash smoke" }, retry: { tenantId: "tenant-a", principalId: "principal-a", workspaceName: "Stash smoke" } },
        bedrock: { modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", providerRequestId: "bedrock-1" },
        s3: { providerRequestId: "s3-1", versionId: "version-1", key: "artifacts/smoke.json" },
        eventBridge: { providerRequestId: "events-1", eventId: "event-1" },
      },
      vector: { environment: "local-cockroachdb", schemaHasVector1024: true, eligibleIndexes: ["memory_versions_embedding_idx"], explainUsesVectorIndex: true },
      cloudWatch: { eventId: "log-1" },
      xray: { traceId: "trace-1" },
    })).toThrow(/vector/i);
  });

  it("accepts only a complete set of independently observed production proofs", () => {
    expect(validateProductionEvidence({
      smoke: {
        environment: "production", apiBaseUrl: "https://abc.execute-api.us-east-1.amazonaws.com/v1",
        health: { status: "ok", requestId: "health-1" },
        workspace: { first: { tenantId: "tenant-a", principalId: "principal-a", workspaceName: "Stash smoke" }, retry: { tenantId: "tenant-a", principalId: "principal-a", workspaceName: "Stash smoke" } },
        bedrock: { modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0", providerRequestId: "bedrock-1" },
        s3: { providerRequestId: "s3-1", versionId: "version-1", key: "artifacts/smoke.json" },
        eventBridge: { providerRequestId: "events-1", eventId: "event-1" },
      },
      vector: { environment: "cockroach-cloud", schemaHasVector1024: true, eligibleIndexes: ["memory_versions_embedding_idx"], explainUsesVectorIndex: true },
      cloudWatch: { eventId: "log-1" },
      xray: { traceId: "trace-1" },
    })).toMatchObject({ verified: true });
  });

  it("requires exact S3 bytes/version/metadata and an observed EventBridge/Bedrock record", () => {
    const body = Buffer.from(JSON.stringify({ runId: "run-1" })); const digest = createHash("sha256").update(body).digest("hex");
    expect(validateObservedArtifact({ ETag: "etag", VersionId: "v1", Metadata: { "content-sha256": digest } }, body, { runId: "run-1", s3: { versionId: "v1", digest } })).toEqual({ etag: "etag" });
    expect(() => validateObservedArtifact({ ETag: "etag", VersionId: "v1", Metadata: { "content-sha256": digest } }, Buffer.from("{}"), { runId: "run-1", s3: { versionId: "v1", digest } })).toThrow(/S3/i);
    const smoke = { runId: "run-1", startedAt: "2026-08-17T17:00:00.000Z", generatedAt: "2026-08-17T17:01:00.000Z", aws: { accountId: "123456789012", region: "us-east-1" }, eventBridge: { eventId: "event-1" }, bedrock: { evaluator: { modelId: "eval", providerRequestId: "eval-1" }, embedding: { modelId: "embed", providerRequestId: "embed-1", dimensions: 1024 } } };
    const envelope = { id: "event-1", source: "memory-ci", "detail-type": "stash.cloud_smoke", account: "123456789012", region: "us-east-1", time: "2026-08-17T17:00:30.000Z", detail: { payload: { runId: "run-1", evaluator: { modelId: "eval", providerRequestId: "eval-1" }, embedding: { modelId: "embed", providerRequestId: "embed-1", dimensions: 1024 } } } };
    expect(extractObservedServiceEvent({ events: [{ eventId: "log-1", message: JSON.stringify(envelope) }] }, smoke)).toBe("log-1");
    expect(extractObservedServiceEvent({ events: [{ eventId: "log-1", message: JSON.stringify({ detail: { eventId: "event-1", payload: { runId: "different" } } }) }] }, smoke)).toBeNull();
  });

  it("rejects X-Ray traces whose segment lies outside the smoke window", () => {
    const trace = { Traces: [{ Id: "1-trace", Segments: [{ Document: JSON.stringify({ start_time: 100, end_time: 101 }) }] }] };
    expect(extractObservedTraceId(trace, "1-trace", new Date(99_000).toISOString(), new Date(102_000).toISOString())).toBe("1-trace");
    expect(extractObservedTraceId(trace, "1-trace", new Date(200_000).toISOString(), new Date(201_000).toISOString())).toBeNull();
  });
});
