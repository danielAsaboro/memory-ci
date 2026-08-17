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

  it("forwards the exact nonce CSP context that it returns to the browser", () => {
    const response = proxy(new NextRequest("https://trystash.xyz/overview"));
    const responsePolicy = response.headers.get("content-security-policy");
    const requestPolicy = response.headers.get("x-middleware-request-content-security-policy");
    const forwardedNonce = response.headers.get("x-middleware-request-x-nonce");

    expect(requestPolicy).toBe(responsePolicy);
    expect(forwardedNonce).toMatch(/^[a-f0-9]{32}$/);
    expect(responsePolicy).toContain(`'nonce-${forwardedNonce}'`);
    expect(responsePolicy).toMatch(/script-src[^;]*'strict-dynamic'/);
  });
});
