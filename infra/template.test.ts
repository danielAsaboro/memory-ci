import { readFile } from "node:fs/promises";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const templatePath = new URL("./template.yaml", import.meta.url);

describe("AWS SAM template", () => {
  it("defines the complete secured application and evidence plane", async () => {
    const template = parse(await readFile(templatePath, "utf8")) as {
      Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
    };
    const types = Object.values(template.Resources).map((resource) => resource.Type);
    expect(types).toEqual(expect.arrayContaining([
      "AWS::Serverless::Api", "AWS::Cognito::UserPool", "AWS::Cognito::UserPoolClient",
      "AWS::Serverless::Function", "AWS::Events::EventBus", "AWS::S3::Bucket",
      "AWS::Logs::LogGroup", "AWS::CloudWatch::Alarm",
    ]));
    const bucket = template.Resources.EvidenceBucket.Properties as Record<string, unknown>;
    expect(bucket).toMatchObject({
      BucketEncryption: { ServerSideEncryptionConfiguration: [expect.any(Object)] },
      VersioningConfiguration: { Status: "Enabled" },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      },
    });
  });

  it("configures a managed 1024-dimension Bedrock embedding model and exact production parameters", async () => {
    const template = parse(await readFile(templatePath, "utf8")) as {
      Parameters: Record<string, { Default?: string }>;
      Globals: { Function: { Environment: { Variables: Record<string, unknown> } } };
      Resources: Record<string, { Properties?: Record<string, unknown> }>;
    };
    expect(template.Parameters.BedrockEmbeddingModelId?.Default).toBe("amazon.titan-embed-text-v2:0");
    expect(template.Parameters.AllowedOrigin?.Default).toBe("https://trystash.xyz");
    const variables = template.Globals.Function.Environment.Variables;
    expect(variables).toHaveProperty("BEDROCK_EMBEDDING_MODEL_ID");
    expect(variables).toHaveProperty("STASH_TRUSTED_SOURCE_KEYS");
    expect(template.Resources.MemoryEventBus?.Properties).toMatchObject({ Name: "stash" });
  });

  it("has retained logs, alarms, and no wildcard mutation permission", async () => {
    const source = await readFile(templatePath, "utf8");
    const template = parse(source) as { Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> };
    const logGroups = Object.values(template.Resources).filter((resource) => resource.Type === "AWS::Logs::LogGroup");
    const alarms = Object.values(template.Resources).filter((resource) => resource.Type === "AWS::CloudWatch::Alarm");
    expect(logGroups.every((group) => Number(group.Properties?.RetentionInDays) >= 14)).toBe(true);
    expect(alarms.length).toBeGreaterThanOrEqual(2);
    expect(source).not.toMatch(/Action:\s*['"]?\*['"]?/);
    expect(source).not.toMatch(/(?:s3:PutObject|events:PutEvents|bedrock:InvokeModel)[\s\S]{0,180}Resource:\s*['"]?\*['"]?/);
  });

  it("separates API, outbox, and sandbox privileges by Lambda responsibility", async () => {
    const template = parse(await readFile(templatePath, "utf8")) as {
      Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
    };
    expect(template.Resources.OutboxRole?.Type).toBe("AWS::IAM::Role");
    expect(template.Resources.SandboxRole?.Type).toBe("AWS::IAM::Role");
    expect(template.Resources.OutboxFunction?.Properties?.Role).toBeDefined();
    expect(template.Resources.SandboxFunction?.Properties?.Role).toBeDefined();
    const apiPolicies = template.Resources.ApiRole?.Properties?.Policies as Array<{ PolicyDocument?: { Statement?: Array<{ Action?: string[] }> } }> | undefined;
    const apiActions = apiPolicies?.flatMap((policy) => policy.PolicyDocument?.Statement?.flatMap((statement) => statement.Action ?? []) ?? []) ?? [];
    expect(apiActions).not.toEqual(expect.arrayContaining(["s3:PutObject", "events:PutEvents"]));
    const source = await readFile(templatePath, "utf8");
    expect((source.match(/xray:PutTraceSegments/g) ?? []).length).toBe(3);
    expect((source.match(/xray:PutTelemetryRecords/g) ?? []).length).toBe(3);
  });

  it("builds the Bedrock log-stream ARN from the log-group name without an embedded wildcard", async () => {
    const source = await readFile(templatePath, "utf8");
    expect(source).toContain('Fn::Sub: "arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:${BedrockInvocationLogGroup}:log-stream:*"');
    expect(source).not.toContain("${BedrockInvocationLogGroup.Arn}:log-stream");
  });
});
