import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function run(args: string[]) {
  try {
    const { stdout } = await exec("ccloud", args, { timeout: 30_000 });
    return { ok: true, output: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown ccloud error";
    return { ok: false, error: message.replaceAll(/(token|key|secret)=\S+/gi, "$1=[redacted]") };
  }
}

const identity = await run(["auth", "whoami"]);
const clusters = identity.ok ? await run(["cluster", "list", "-o", "json"]) : { ok: false, error: "Skipped because ccloud is not authenticated." };
console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ccloudVersion: await run(["version"]), identity, clusters }, null, 2));
