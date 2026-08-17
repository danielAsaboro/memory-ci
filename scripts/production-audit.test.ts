import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { auditProduction } from "./production-audit";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "stash-production-audit-"));
  fixtureRoots.push(root);
  const safeConfig = `export default {
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'strict-dynamic'" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Permissions-Policy", value: "camera=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
    ] }];
  },
};`;
  const baseFiles = {
    ".env.example": "NEXT_PUBLIC_APP_URL=https://trystash.xyz\nSTASH_API_BASE_URL=https://api.trystash.xyz\n",
    "next.config.mjs": safeConfig,
    "app/page.tsx": "export default function Page() { return null; }\n",
  };
  for (const [path, contents] of Object.entries({ ...baseFiles, ...files })) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

describe("production audit", () => {
  it("accepts a clean production fixture", async () => {
    await expect(auditProduction(await fixture({}))).resolves.toEqual({ ok: true, violations: [] });
  });

  it("rejects a secret-bearing public environment key with a stable rule ID", async () => {
    const result = await auditProduction(await fixture({ ".env.example": "NEXT_PUBLIC_APP_URL=https://trystash.xyz\nNEXT_PUBLIC_DATABASE_URL=postgres://unsafe\n" }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("PUBLIC_ENV_SECRET");
  });

  it("rejects secret patterns in client source maps with a stable rule ID", async () => {
    const result = await auditProduction(await fixture({ ".next/static/chunks/app.js.map": "{\"sourcesContent\":[\"AWS_SECRET_ACCESS_KEY=unsafe\"]}" }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SOURCE_MAP_SECRET");
  });

  it("rejects retired demo domains with a stable rule ID", async () => {
    const result = await auditProduction(await fixture({ "app/page.tsx": "const retired = 'https://chatgpt.site';\n" }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("DEMO_COPY");
  });

  it("rejects sandbox fixture copy with a stable rule ID", async () => {
    const result = await auditProduction(await fixture({ "src/copy.ts": "export const label = 'Sandbox fixture';\n" }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("DEMO_COPY");
  });

  it("rejects a response-header configuration without a Content Security Policy", async () => {
    const result = await auditProduction(await fixture({
      "next.config.mjs": `export default { async headers() { return [{ source: "/(.*)", headers: [
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000" },
      ] }]; } };`,
    }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SECURITY_HEADERS");
  });

  it.each([
    ["unsafe inline scripts", "script-src 'self' 'unsafe-inline'", "max-age=63072000"],
    ["wildcard default source", "script-src 'self'", "max-age=63072000", "default-src *"],
    ["weak script scheme", "script-src https:", "max-age=63072000"],
    ["disabled HSTS", "script-src 'self'", "max-age=0"],
    ["zero-equivalent HSTS", "script-src 'self'", "max-age=00"],
    ["short HSTS", "script-src 'self'", "max-age=60"],
  ])("rejects %s in the security headers", async (_label, scriptSource, hsts, defaultSource = "default-src 'self'") => {
    const result = await auditProduction(await fixture({
      "next.config.mjs": `export default { async headers() { return [{ source: "/(.*)", headers: [
        { key: "Content-Security-Policy", value: "${defaultSource}; ${scriptSource}" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Permissions-Policy", value: "camera=()" },
        { key: "Strict-Transport-Security", value: "${hsts}" },
      ] }]; } };`,
    }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SECURITY_HEADERS");
  });

  it("requires each configured response route to carry the complete header set", async () => {
    const result = await auditProduction(await fixture({
      "next.config.mjs": `export default { async headers() { return [
        { source: "/", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" }] },
        { source: "/api/:path*", headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Permissions-Policy", value: "camera=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ] },
      ]; } };`,
    }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SECURITY_HEADERS");
  });

  it("rejects a conflicting canonical origin in every production environment file", async () => {
    const result = await auditProduction(await fixture({ ".env.production": "NEXT_PUBLIC_APP_URL=https://attacker.example\nSTASH_API_BASE_URL=https://api.trystash.xyz\n" }), { NODE_ENV: "production" });
    expect(result.violations.map((violation) => violation.ruleId)).toContain("CANONICAL_ORIGIN");
  });

  it("requires an effective production API base rather than accepting documentation alone", async () => {
    const result = await auditProduction(await fixture({}), { NODE_ENV: "production" });
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SERVER_API_URL");
  });

  it("rejects an invalid process environment API override", async () => {
    const result = await auditProduction(await fixture({ ".env.production": "STASH_API_BASE_URL=https://api.trystash.xyz\nNEXT_PUBLIC_APP_URL=https://trystash.xyz\n" }), {
      NODE_ENV: "production", STASH_API_BASE_URL: "http://localhost:3000",
    });
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SERVER_API_URL");
  });

  it("uses production-local precedence over lower-priority environment files", async () => {
    const result = await auditProduction(await fixture({
      ".env": "STASH_API_BASE_URL=https://api.trystash.xyz\nNEXT_PUBLIC_APP_URL=https://trystash.xyz\n",
      ".env.production": "STASH_API_BASE_URL=https://api.trystash.xyz\nNEXT_PUBLIC_APP_URL=https://trystash.xyz\n",
      ".env.local": "STASH_API_BASE_URL=http://localhost:3000\nNEXT_PUBLIC_APP_URL=https://attacker.example\n",
    }), { NODE_ENV: "production" });
    expect(result.violations.map((violation) => violation.ruleId)).toEqual(expect.arrayContaining(["SERVER_API_URL", "CANONICAL_ORIGIN"]));
  });

  it("rejects non-production API endpoints", async () => {
    const result = await auditProduction(await fixture({ ".env.example": "NEXT_PUBLIC_APP_URL=https://trystash.xyz\nSTASH_API_BASE_URL=http://localhost:3000\n" }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain("SERVER_API_URL");
  });

  it.each([
    ["client chunk", ".next/static/chunks/app.js", "STASH_SESSION_SECRET=matched-client-value"],
    ["source map", ".next/static/chunks/app.js.map", "STASH_BOOTSTRAP_KEY=matched-map-value"],
  ])("rejects a %s containing a server secret without reporting its value", async (_label, path, contents) => {
    const result = await auditProduction(await fixture({ [path]: contents }));
    expect(result.violations.map((violation) => violation.ruleId)).toContain(path.endsWith(".map") ? "SOURCE_MAP_SECRET" : "CLIENT_SECRET");
    expect(JSON.stringify(result)).not.toContain(contents.split("=")[1]!);
  });

  it("emits JSON only and exits non-zero without leaking a matched client secret", async () => {
    const root = await fixture({ ".next/static/chunks/app.js": "STASH_SESSION_SECRET=cli-only-secret" });
    const script = new URL("./production-audit.ts", import.meta.url).pathname;
    const tsxLoader = new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).pathname;
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", tsxLoader, script], { cwd: root });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain("cli-only-secret");
  });
});
