import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { putArtifact, type S3Transport } from "./s3";

describe("S3 evidence artifacts", () => {
  it("writes content-addressed encrypted artifacts and returns provider evidence", async () => {
    const body = JSON.stringify({ status: "passed" });
    const digest = createHash("sha256").update(body).digest("hex");
    let request: Record<string, unknown> = {};
    const transport: S3Transport = {
      async put(input) {
        request = input as unknown as Record<string, unknown>;
        return { VersionId: "version-1", ETag: '"etag-1"', $metadata: { requestId: "s3-request-1" } };
      },
    };
    const receipt = await putArtifact(transport, "memory-ci-evidence", { body, digest, mediaType: "application/json" });
    expect(receipt).toEqual({
      uri: `s3://memory-ci-evidence/artifacts/${digest}.json`, digest,
      versionId: "version-1", providerRequestId: "s3-request-1", etag: '"etag-1"',
    });
    expect(request).toMatchObject({
      Bucket: "memory-ci-evidence", Key: `artifacts/${digest}.json`,
      ContentType: "application/json", ServerSideEncryption: "AES256", IfNoneMatch: "*",
    });
    expect(request.ChecksumSHA256).toBe(Buffer.from(digest, "hex").toString("base64"));
  });

  it("rejects a digest mismatch before contacting S3", async () => {
    const transport: S3Transport = { async put() { throw new Error("must not execute"); } };
    await expect(putArtifact(transport, "bucket", {
      body: "actual", digest: "0".repeat(64), mediaType: "application/json",
    })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
