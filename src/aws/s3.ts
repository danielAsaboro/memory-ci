import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client, type PutObjectCommandInput, type PutObjectCommandOutput } from "@aws-sdk/client-s3";

import { DomainError } from "../domain/errors";

export interface S3Transport { put(input: PutObjectCommandInput): Promise<PutObjectCommandOutput> }

export class AwsSdkS3Transport implements S3Transport {
  constructor(private readonly client: S3Client) {}
  put(input: PutObjectCommandInput): Promise<PutObjectCommandOutput> {
    return this.client.send(new PutObjectCommand(input));
  }
}

export async function putArtifact(
  transport: S3Transport,
  bucket: string,
  input: { body: string; digest: string; mediaType: "application/json" },
): Promise<{ uri: string; digest: string; versionId: string | null; providerRequestId: string | null; etag: string | null }> {
  const actual = createHash("sha256").update(input.body).digest("hex");
  if (actual !== input.digest) throw new DomainError("invalid_input", "Artifact digest does not match its body.");
  const key = `artifacts/${input.digest}.json`;
  const response = await transport.put({
    Bucket: bucket, Key: key, Body: input.body, ContentType: input.mediaType,
    ChecksumSHA256: Buffer.from(input.digest, "hex").toString("base64"),
    ServerSideEncryption: "AES256", IfNoneMatch: "*",
    Metadata: { "content-sha256": input.digest },
  });
  return {
    uri: `s3://${bucket}/${key}`, digest: input.digest, versionId: response.VersionId ?? null,
    providerRequestId: response.$metadata.requestId ?? null, etag: response.ETag ?? null,
  };
}
