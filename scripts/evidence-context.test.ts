import { describe, expect, it } from "vitest";

import { buildEvidenceContext } from "./evidence-context";

describe("evidence context producer", () => {
  it("creates the one strict shared context only from complete live identity facts", () => {
    const context = buildEvidenceContext({ Account: "123456789012" }, {
      StackId: "arn:aws:cloudformation:us-east-1:123456789012:stack/stash-production/abc", StackName: "stash-production",
      Outputs: [{ OutputKey: "ApiUrl", OutputValue: "https://abc.execute-api.us-east-1.amazonaws.com/v1" }, { OutputKey: "EvidenceBucketName", OutputValue: "stash-evidence" }, { OutputKey: "EventBusName", OutputValue: "stash" }],
      Parameters: [{ ParameterKey: "DatabaseSecretArn", ParameterValue: "arn:aws:secretsmanager:us-east-1:123456789012:secret:stash/database-abc" }, { ParameterKey: "BedrockModelId", ParameterValue: "us.anthropic.claude-haiku-4-5-20251001-v1:0" }, { ParameterKey: "BedrockEmbeddingModelId", ParameterValue: "amazon.titan-embed-text-v2:0" }],
    }, { COCKROACH_CLUSTER_ID: "cluster-1", COCKROACH_ORGANIZATION_ID: "org-1", COCKROACH_HOST: "cluster-1.aws-us-east-1.cockroachlabs.cloud", COCKROACH_TIER: "BASIC" });
    expect(context).toMatchObject({ schemaVersion: 2, aws: { accountId: "123456789012" }, cockroach: { clusterId: "cluster-1", tier: "BASIC" } });
  });

  it("fails closed when a stack output or Cockroach fact is absent", () => {
    expect(() => buildEvidenceContext({ Account: "123456789012" }, {}, {})).toThrow(/complete/i);
  });
});
