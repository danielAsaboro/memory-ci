import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parse } from "yaml";

export const productionParameterNames = [
  "DatabaseSecretArn", "BedrockModelId", "BedrockEmbeddingModelId", "StashSessionSecret", "StashBootstrapKey", "StashTrustedSourceKeys", "AllowedOrigin",
] as const;

export type ProductionParameters = Record<(typeof productionParameterNames)[number], string>;

export function assertTemplateParameterNames(templateNames: readonly string[]): void {
  const expected = new Set(productionParameterNames);
  const actual = new Set(templateNames);
  const missing = productionParameterNames.filter((name) => !actual.has(name));
  const unknown = [...actual].filter((name) => !expected.has(name as (typeof productionParameterNames)[number]));
  if (missing.length || unknown.length) throw new Error(`SAM parameter contract mismatch: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}.`);
}

export function validateProductionParameters(value: unknown): ProductionParameters {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Production parameters must be a JSON object.");
  const record = value as Record<string, unknown>;
  const missing = productionParameterNames.filter((name) => typeof record[name] !== "string" || record[name].trim().length === 0);
  const unknown = Object.keys(record).filter((name) => !productionParameterNames.includes(name as (typeof productionParameterNames)[number]));
  if (missing.length || unknown.length) throw new Error(`Invalid production parameters: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}.`);
  if (record.AllowedOrigin !== "https://trystash.xyz") throw new Error("AllowedOrigin must be https://trystash.xyz.");
  for (const name of ["StashSessionSecret", "StashBootstrapKey"] as const) if ((record[name] as string).length < 32) throw new Error(`${name} must contain at least 32 bytes.`);
  return Object.fromEntries(productionParameterNames.map((name) => [name, record[name]])) as ProductionParameters;
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
