import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { buildSamDeployArgs, buildSamDeployConfig, readProductionParameters, validateProductionParameters } from "./production-parameters";

function commandJson(command: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => execFile(command, args, { timeout: 30_000, maxBuffer: 100_000 }, (error, stdout) => {
    if (error) { reject(new Error("Deployment identity could not be verified.")); return; }
    try {
      const value: unknown = JSON.parse(stdout);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
      resolve(value as Record<string, unknown>);
    } catch { reject(new Error("Deployment identity could not be verified.")); }
  }));
}

async function main(): Promise<void> {
  const parameterFile = process.env.STASH_PARAMETER_FILE ?? "infra/parameters.production.json";
  const parameters = await readProductionParameters(parameterFile);
  const identity = await commandJson("aws", ["sts", "get-caller-identity", "--output", "json"]);
  if (typeof identity.Account !== "string") throw new Error("Deployment identity could not be verified.");
  validateProductionParameters(parameters, { accountId: identity.Account, region: "us-east-1" });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "stash-sam-deploy-"));
  const configFile = join(temporaryRoot, "samconfig.yaml");
  let code: number | null;
  try {
    await writeFile(configFile, buildSamDeployConfig(parameters), { flag: "wx", mode: 0o600 });
    const child = spawn("sam", buildSamDeployArgs(configFile), { stdio: "inherit" });
    code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (code !== 0) throw new Error("SAM production deployment failed.");
  const described = await commandJson("aws", ["cloudformation", "describe-stacks", "--stack-name", "stash-production", "--region", "us-east-1", "--output", "json"]);
  const stack = Array.isArray(described.Stacks) ? described.Stacks[0] : undefined;
  const output = stack && typeof stack === "object" && Array.isArray((stack as { Outputs?: unknown }).Outputs) ? (stack as { Outputs: Array<{ OutputKey?: unknown; OutputValue?: unknown }> }).Outputs.find((item) => item.OutputKey === "BedrockLoggingRoleArn")?.OutputValue : undefined;
  if (typeof output !== "string") throw new Error("Bedrock logging role output is unavailable.");
  const logging = spawn("tsx", ["scripts/bedrock-logging.ts"], { stdio: "inherit", env: { ...process.env, STASH_BEDROCK_LOGGING_ROLE_ARN: output } });
  const loggingCode = await new Promise<number | null>((resolve, reject) => { logging.on("error", reject); logging.on("close", resolve); });
  if (loggingCode !== 0) throw new Error("Bedrock invocation logging setup failed.");
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Production deployment failed."}\n`); process.exitCode = 1; });
