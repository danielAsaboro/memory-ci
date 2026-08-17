import { z } from "zod";

const awsConfigSchema = z.object({
  DATABASE_SECRET_ARN: z.string().min(1),
  AWS_REGION: z.string().min(1),
  BEDROCK_MODEL_ID: z.string().min(1),
  EVIDENCE_BUCKET: z.string().min(1),
  EVENT_BUS_NAME: z.string().min(1),
  BEDROCK_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(20_000),
});

export function loadAwsConfig(environment: NodeJS.ProcessEnv = process.env) {
  return awsConfigSchema.parse(environment);
}
