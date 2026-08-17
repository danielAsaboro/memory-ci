import { spawn } from "node:child_process";

import { startE2eApi } from "./e2e-api";

const apiPort = process.env.STASH_E2E_API_PORT ?? "3011";
const appPort = process.env.STASH_E2E_APP_PORT ?? "3301";
process.env.STASH_E2E_API_PORT = apiPort;
process.env.STASH_API_BASE_URL = `http://127.0.0.1:${apiPort}`;
process.env.STASH_SESSION_SECRET ??= "stash-e2e-session-secret-that-is-at-least-32-bytes";
process.env.STASH_BOOTSTRAP_KEY ??= "stash-e2e-bootstrap-key";
process.env.STASH_E2E = "1";
// Test-only public key: the corresponding private key lives solely in the Playwright spec.
process.env.STASH_TRUSTED_SOURCE_KEYS = JSON.stringify([{ identity: "e2e-policy-owner", keyId: "e2e-v1", publicKey: "MCowBQYDK2VwAyEAOIRGYgILOl6/p2JN7GM3/xVIFiIOf9xO45Mo8+D5K3s=" }]);

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)));
    child.once("error", reject);
  });
}

const stop = await startE2eApi();
let stopping = false;
const shutdown = async () => { if (stopping) return; stopping = true; await stop(); process.exit(0); };
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });
try {
  await run("npm", ["run", "build"]);
  await run("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", appPort]);
} finally { await stop(); }
