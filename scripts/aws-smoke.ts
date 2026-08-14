import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { analyzeCandidateWithBedrock, AwsSdkBedrockTransport } from "../src/aws/bedrock";
import { loadAwsConfig } from "../src/aws/config";

const config = loadAwsConfig();
const identity = await new STSClient({ region: config.AWS_REGION }).send(new GetCallerIdentityCommand({}));
const result = await analyzeCandidateWithBedrock({
  candidateText: "Refunds above $150 require human review.",
  trustClass: "authoritative",
  deterministicFindings: [],
}, {
  modelId: config.BEDROCK_MODEL_ID,
  timeoutMs: config.BEDROCK_TIMEOUT_MS,
  transport: new AwsSdkBedrockTransport(new BedrockRuntimeClient({ region: config.AWS_REGION })),
});
if (result.status !== "complete" || !result.providerRequestId) {
  throw new Error(`Bedrock smoke was not authenticated and complete: ${JSON.stringify(result)}`);
}
process.stdout.write(`${JSON.stringify({
  verified: true, account: identity.Account, arn: identity.Arn, modelId: result.modelId,
  providerRequestId: result.providerRequestId, riskLevel: result.value.riskLevel,
}, null, 2)}\n`);
