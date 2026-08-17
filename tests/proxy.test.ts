import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../proxy";

describe("production CSP proxy", () => {
  it("sets a per-request nonce CSP without unsafe inline scripts", () => {
    const response = proxy(new NextRequest("https://trystash.xyz/overview"));
    const policy = response.headers.get("content-security-policy") ?? "";
    const scriptSource = policy.match(/script-src[^;]*/)?.[0] ?? "";

    expect(policy).toMatch(/script-src[^;]*'nonce-[^']+'/);
    expect(policy).toContain("'strict-dynamic'");
    expect(scriptSource).not.toContain("'unsafe-inline'");
    expect(response.headers.get("strict-transport-security")).toMatch(/max-age=63072000/);
  });
});
