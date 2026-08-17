import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { buildSamDeployArgs, readProductionParameters } from "./production-parameters";

async function main(): Promise<void> {
  const parameterFile = process.env.STASH_PARAMETER_FILE ?? "infra/parameters.production.json";
  await readProductionParameters(parameterFile);
  const child = spawn("sam", buildSamDeployArgs(parameterFile), { stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  if (code !== 0) throw new Error("SAM production deployment failed.");
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Production deployment failed."}\n`); process.exitCode = 1; });
