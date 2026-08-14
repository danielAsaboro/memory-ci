import { z } from "zod";

const awsConfigSchema = z.object({
  AWS_REGION: z.string().min(1).default("us-east-1"),
  BEDROCK_MODEL_ID: z.string().min(1),
  BEDROCK_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
});

export function loadAwsConfig(environment: NodeJS.ProcessEnv = process.env) {
  return awsConfigSchema.parse(environment);
}
