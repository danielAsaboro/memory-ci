import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { signWorkspaceSession, verifyWorkspaceSession } from "./workspace-session";

const secret = "0123456789abcdef0123456789abcdef";
const wrongSecret = "abcdef0123456789abcdef0123456789";
const issuedAt = new Date("2026-08-17T00:00:00Z");
const session = {
  tenantId: "tenant-1",
  principalId: "principal-1",
  roles: ["admin", "reviewer"],
  workspaceName: "Northstar",
};

describe("workspace sessions", () => {
  it("round-trips signed workspace claims for one day", async () => {
    const token = await signWorkspaceSession(session, secret, issuedAt);

    await expect(
      verifyWorkspaceSession(token, secret, new Date("2026-08-17T00:01:00Z")),
    ).resolves.toEqual({
      ...session,
      expiresAt: 1_787_011_200,
    });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signWorkspaceSession(session, secret, issuedAt);

    await expect(
      verifyWorkspaceSession(token, wrongSecret, new Date("2026-08-17T00:01:00Z")),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: "Workspace session is invalid or expired.",
    });
  });

  it("rejects a token issued for another audience", async () => {
    const token = await new SignJWT(session)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://trystash.xyz")
      .setAudience("another-api")
      .setIssuedAt(issuedAt)
      .setExpirationTime(1_893_456_000)
      .sign(new TextEncoder().encode(secret));

    await expect(
      verifyWorkspaceSession(token, secret, new Date("2026-08-17T00:01:00Z")),
    ).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects an expired token", async () => {
    const token = await signWorkspaceSession(session, secret, issuedAt);

    await expect(
      verifyWorkspaceSession(token, secret, new Date("2026-08-18T00:00:01Z")),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("requires a session secret of at least 32 bytes", async () => {
    await expect(signWorkspaceSession(session, "too-short", issuedAt)).rejects.toThrow(
      "at least 32 bytes",
    );
  });
});
