import { execFile, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildSamDeployArgs, readProductionParameters, validateProductionParameters } from "./production-parameters";

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
  const child = spawn("sam", buildSamDeployArgs(parameterFile), { stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  if (code !== 0) throw new Error("SAM production deployment failed.");
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Production deployment failed."}\n`); process.exitCode = 1; });
