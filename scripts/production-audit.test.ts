import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      { key: "Content-Security-Policy", value: "default-src 'self'" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Permissions-Policy", value: "camera=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000" },
    ] }];
  },
};`;
  const baseFiles = {
    ".env.example": "NEXT_PUBLIC_APP_URL=https://trystash.xyz\n",
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
});
