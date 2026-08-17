import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { atomicWriteJson, safeErrorMessage, validateEvidenceContext } from "./evidence-contract";

const exec = promisify(execFile);
type Stack = Readonly<{ StackId?: unknown; StackName?: unknown; Outputs?: unknown; Parameters?: unknown }>;

function strings(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.flatMap((item) => item && typeof item === "object" && typeof (item as { OutputKey?: unknown; ParameterKey?: unknown }).OutputKey === "string" && typeof (item as { OutputValue?: unknown }).OutputValue === "string" ? [[(item as { OutputKey: string }).OutputKey, (item as { OutputValue: string }).OutputValue]] : item && typeof item === "object" && typeof (item as { ParameterKey?: unknown }).ParameterKey === "string" && typeof (item as { ParameterValue?: unknown }).ParameterValue === "string" ? [[(item as { ParameterKey: string }).ParameterKey, (item as { ParameterValue: string }).ParameterValue]] : []));
}

export function buildEvidenceContext(identity: Record<string, unknown>, stack: Stack, environment: Readonly<Record<string, string | undefined>>) {
  const outputs = strings(stack.Outputs); const parameters = strings(stack.Parameters);
  if (typeof identity.Account !== "string" || typeof stack.StackId !== "string" || stack.StackName !== "stash-production" || !outputs.ApiUrl || !outputs.EvidenceBucketName || !outputs.EventBusName || !parameters.DatabaseSecretArn || !parameters.BedrockModelId || !parameters.BedrockEmbeddingModelId || !environment.COCKROACH_CLUSTER_ID || !environment.COCKROACH_SQL_CLUSTER_ID || !environment.COCKROACH_ORGANIZATION_ID || !environment.COCKROACH_HOST || !environment.COCKROACH_TIER) throw new Error("Complete live stack and CockroachDB identity facts are required for evidence context.");
  return validateEvidenceContext({ schemaVersion: 2, runId: crypto.randomUUID(), generatedAt: new Date().toISOString(), aws: { accountId: identity.Account, region: "us-east-1", stackName: stack.StackName, stackId: stack.StackId, apiUrl: outputs.ApiUrl, bucket: outputs.EvidenceBucketName, eventBus: outputs.EventBusName, databaseSecretArn: parameters.DatabaseSecretArn, evaluatorModelId: parameters.BedrockModelId, embeddingModelId: parameters.BedrockEmbeddingModelId }, cockroach: { clusterId: environment.COCKROACH_CLUSTER_ID, sqlClusterId: environment.COCKROACH_SQL_CLUSTER_ID, organizationId: environment.COCKROACH_ORGANIZATION_ID, region: "us-east-1", tier: environment.COCKROACH_TIER, host: environment.COCKROACH_HOST } });
}

async function awsJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await exec("aws", [...args, "--region", "us-east-1", "--output", "json"], { timeout: 30_000, maxBuffer: 1_000_000 });
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("AWS identity command did not return structured JSON.");
  return parsed as Record<string, unknown>;
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: npm run evidence:context -- /tmp/stash-evidence-context.json");
  const [identity, described] = await Promise.all([awsJson(["sts", "get-caller-identity"]), awsJson(["cloudformation", "describe-stacks", "--stack-name", "stash-production"])]);
  const stack = Array.isArray(described.Stacks) ? described.Stacks[0] : undefined;
  if (!stack || typeof stack !== "object" || Array.isArray(stack)) throw new Error("Production CloudFormation stack is unavailable.");
  const context = buildEvidenceContext(identity, stack, process.env);
  await atomicWriteJson(output, context);
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
}
const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
