import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

export const productionParameterNames = [
  "DatabaseSecretArn", "BedrockModelId", "BedrockEmbeddingModelId", "StashSessionSecret", "StashBootstrapKey", "StashTrustedSourceKeys", "AllowedOrigin",
] as const;

export type ProductionParameters = Record<(typeof productionParameterNames)[number], string>;

const secretArn = /^arn:aws:secretsmanager:us-east-1:(\d{12}):secret:stash\/[A-Za-z0-9/_+=.@-]+$/;
const placeholder = /(?:replace|example|placeholder|000000000000|localhost|127\.0\.0\.1)/i;

export function assertTemplateParameterNames(templateNames: readonly string[]): void {
  const expected = new Set(productionParameterNames);
  const actual = new Set(templateNames);
  const missing = productionParameterNames.filter((name) => !actual.has(name));
  const unknown = [...actual].filter((name) => !expected.has(name as (typeof productionParameterNames)[number]));
  if (missing.length || unknown.length) throw new Error(`SAM parameter contract mismatch: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}.`);
}

export function validateProductionParameters(value: unknown, deploymentIdentity?: Readonly<{ accountId: string; region: string }>): ProductionParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Production parameters must be a JSON object.");
  const record = value as Record<string, unknown>;
  const missing = productionParameterNames.filter((name) => typeof record[name] !== "string" || record[name].trim().length === 0);
  const unknown = Object.keys(record).filter((name) => !productionParameterNames.includes(name as (typeof productionParameterNames)[number]));
  if (missing.length || unknown.length) throw new Error(`Invalid production parameters: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}.`);
  if (record.AllowedOrigin !== "https://trystash.xyz") throw new Error("AllowedOrigin must be https://trystash.xyz.");
  const arn = secretArn.exec(record.DatabaseSecretArn as string);
  if (!arn || placeholder.test(record.DatabaseSecretArn as string) || (deploymentIdentity && (deploymentIdentity.region !== "us-east-1" || deploymentIdentity.accountId !== arn[1]))) throw new Error("DatabaseSecretArn must be a non-placeholder us-east-1 Stash Secrets Manager ARN matching deployment identity.");
  if (record.BedrockModelId !== "us.anthropic.claude-haiku-4-5-20251001-v1:0" || record.BedrockEmbeddingModelId !== "amazon.titan-embed-text-v2:0") throw new Error("Bedrock model IDs are not approved for this production template.");
  for (const name of ["StashSessionSecret", "StashBootstrapKey"] as const) {
    const secret = record[name] as string;
    if (secret.length < 32 || placeholder.test(secret)) throw new Error(`${name} must contain a non-placeholder value of at least 32 bytes.`);
  }
  let keys: unknown;
  try { keys = JSON.parse(record.StashTrustedSourceKeys as string); } catch { throw new Error("StashTrustedSourceKeys must be valid JSON."); }
  if (!Array.isArray(keys) || keys.length === 0) throw new Error("StashTrustedSourceKeys must include at least one trusted Ed25519 public key.");
  for (const key of keys) {
    if (!key || typeof key !== "object" || typeof (key as Record<string, unknown>).identity !== "string" || typeof (key as Record<string, unknown>).keyId !== "string" || typeof (key as Record<string, unknown>).publicKey !== "string") throw new Error("StashTrustedSourceKeys entry is invalid.");
    try {
      const parsed = createPublicKey({ key: Buffer.from((key as Record<string, string>).publicKey, "base64"), format: "der", type: "spki" });
      if (parsed.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    } catch { throw new Error("StashTrustedSourceKeys contains an invalid Ed25519 public key."); }
  }
  return Object.fromEntries(productionParameterNames.map((name) => [name, record[name]])) as ProductionParameters;
}

export function buildSamDeployArgs(parameterFile: string): string[] {
  if (!parameterFile || parameterFile.includes("\0")) throw new Error("Production parameter file path is invalid.");
  return ["deploy", "--template-file", ".aws-sam/build/template.yaml", "--stack-name", "stash-production", "--region", "us-east-1", "--capabilities", "CAPABILITY_IAM", "--resolve-s3", "--no-confirm-changeset", "--parameter-overrides", `file://${parameterFile}`];
}

export async function readProductionParameters(path: string): Promise<ProductionParameters> {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error(`Production parameter file is unreadable: ${path}`); }
  return validateProductionParameters(parsed);
}

async function assertTemplateContract(path = "infra/template.yaml"): Promise<void> {
  const template = parse(await readFile(path, "utf8")) as { Parameters?: Record<string, unknown> };
  assertTemplateParameterNames(Object.keys(template.Parameters ?? {}));
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) {
  const path = process.argv[2] ?? "infra/parameters.production.json";
  Promise.all([readProductionParameters(path), assertTemplateContract()]).then(() => process.stdout.write(`Validated production parameter names: ${productionParameterNames.join(", ")}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Production parameter validation failed."}\n`);
    process.exitCode = 1;
  });
}
