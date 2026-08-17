import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { productionParameterNames, readProductionParameters } from "./production-parameters";

async function main(): Promise<void> {
  const parameters = await readProductionParameters(process.env.STASH_PARAMETER_FILE ?? "infra/parameters.production.json");
  const child = spawn("sam", [
    "deploy", "--template-file", ".aws-sam/build/template.yaml", "--stack-name", process.env.STASH_STACK_NAME ?? "stash-production",
    "--region", process.env.AWS_REGION ?? "us-east-1", "--capabilities", "CAPABILITY_IAM", "--resolve-s3", "--no-confirm-changeset",
    "--parameter-overrides", ...productionParameterNames.map((name) => `ParameterKey=${name},ParameterValue=${parameters[name]}`),
  ], { stdio: "inherit" });
  const code = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  if (code !== 0) throw new Error("SAM production deployment failed.");
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Production deployment failed."}\n`); process.exitCode = 1; });
