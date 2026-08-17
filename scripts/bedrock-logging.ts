import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const logGroupName = "/aws/bedrock/stash-production-invocations";

async function aws(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await exec("aws", [...args, "--region", "us-east-1", "--output", "json"], { timeout: 30_000, maxBuffer: 1_000_000 });
  return stdout ? JSON.parse(stdout) as Record<string, unknown> : {};
}

async function main(): Promise<void> {
  const roleArn = process.env.STASH_BEDROCK_LOGGING_ROLE_ARN;
  if (!roleArn) throw new Error("STASH_BEDROCK_LOGGING_ROLE_ARN is required.");
  const root = await mkdtemp(join(tmpdir(), "stash-bedrock-logging-")); const config = join(root, "config.json");
  try {
    await writeFile(config, JSON.stringify({ cloudWatchConfig: { logGroupName, roleArn }, textDataDeliveryEnabled: true, embeddingDataDeliveryEnabled: true }), { mode: 0o600 });
    await aws(["bedrock", "put-model-invocation-logging-configuration", "--logging-config", `file://${config}`]);
    const observed = await aws(["bedrock", "get-model-invocation-logging-configuration"]);
    const logging = observed.loggingConfig as { cloudWatchConfig?: { logGroupName?: string; roleArn?: string }; textDataDeliveryEnabled?: boolean; embeddingDataDeliveryEnabled?: boolean } | undefined;
    if (logging?.cloudWatchConfig?.logGroupName !== logGroupName || logging.cloudWatchConfig.roleArn !== roleArn || logging.textDataDeliveryEnabled !== true || logging.embeddingDataDeliveryEnabled !== true) throw new Error("Bedrock invocation logging configuration did not match the stack-owned destination.");
  } finally { await rm(root, { recursive: true, force: true }); }
}
main().catch(() => { process.stderr.write("Bedrock invocation logging configuration failed.\n"); process.exitCode = 1; });
