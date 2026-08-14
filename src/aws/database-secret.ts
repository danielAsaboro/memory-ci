import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

let cachedConnectionString: string | undefined;

export async function resolveDatabaseConnectionString(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (cachedConnectionString) return cachedConnectionString;
  if (environment.DATABASE_URL) return environment.DATABASE_URL;
  const secretId = environment.DATABASE_SECRET_ARN;
  if (!secretId) throw new Error("DATABASE_SECRET_ARN is required");
  const response = await new SecretsManagerClient({ region: environment.AWS_REGION }).send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!response.SecretString) throw new Error("Database secret does not contain SecretString");
  const parsed: unknown = JSON.parse(response.SecretString);
  if (typeof parsed !== "object" || parsed === null) throw new Error("Database secret must be a JSON object");
  const value = (parsed as Record<string, unknown>).DATABASE_URL ?? (parsed as Record<string, unknown>).connectionString;
  if (typeof value !== "string" || !value.startsWith("postgres")) {
    throw new Error("Database secret must contain DATABASE_URL or connectionString");
  }
  cachedConnectionString = value;
  return value;
}
