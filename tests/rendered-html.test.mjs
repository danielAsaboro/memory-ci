import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import test from "node:test";

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("Could not allocate a local test port."));
        return;
      }

      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function render() {
  const port = await availablePort();
  const server = spawn("./node_modules/.bin/next", ["start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/overview`, {
        headers: { accept: "text/html" },
      });
      return { response, server };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  server.kill();
  throw new Error(`Next.js production server did not start.\n${output}`);
}

test("server-renders the Stash production identity", async (t) => {
  const { response, server } = await render();
  t.after(() => server.kill());

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, />Stash</);
  assert.match(html, /https:\/\/trystash\.xyz/);
  assert.doesNotMatch(html, /Memory CI|Sandbox demo|chatgpt\.site/);
});
