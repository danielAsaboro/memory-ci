import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

import type { AuthVerifier } from "../api/auth";
import { DomainError } from "../domain/errors";

export const WORKSPACE_SESSION_AUDIENCE = "stash-api";
export const WORKSPACE_SESSION_ISSUER = "https://trystash.xyz";
export const WORKSPACE_SESSION_MAX_AGE_SECONDS = 86_400;

const workspaceSessionClaimsSchema = z.object({
  tenantId: z.string().min(1),
  principalId: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  workspaceName: z.string().min(1),
  exp: z.number().int().positive(),
});

export type WorkspaceSession = {
  tenantId: string;
  principalId: string;
  roles: readonly string[];
  workspaceName: string;
  expiresAt: number;
};

export type WorkspaceSessionInput = Omit<WorkspaceSession, "expiresAt">;

export async function signWorkspaceSession(
  input: WorkspaceSessionInput,
  secret: string,
  now = new Date(),
): Promise<string> {
  const expiresAt = Math.floor(now.getTime() / 1_000) + WORKSPACE_SESSION_MAX_AGE_SECONDS;

  return new SignJWT({
    tenantId: input.tenantId,
    principalId: input.principalId,
    roles: [...input.roles],
    workspaceName: input.workspaceName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(WORKSPACE_SESSION_ISSUER)
    .setAudience(WORKSPACE_SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secretBytes(secret));
}

export async function verifyWorkspaceSession(
  token: string,
  secret: string,
  now = new Date(),
): Promise<WorkspaceSession> {
  try {
    const { payload } = await jwtVerify(token, secretBytes(secret), {
      algorithms: ["HS256"],
      audience: WORKSPACE_SESSION_AUDIENCE,
      issuer: WORKSPACE_SESSION_ISSUER,
      currentDate: now,
    });
    const claims = workspaceSessionClaimsSchema.parse(payload);

    return {
      tenantId: claims.tenantId,
      principalId: claims.principalId,
      roles: claims.roles,
      workspaceName: claims.workspaceName,
      expiresAt: claims.exp,
    };
  } catch {
    throw new DomainError("unauthorized", "Workspace session is invalid or expired.");
  }
}

export function createWorkspaceSessionVerifier(secret: string): AuthVerifier {
  return {
    async verify(token) {
      const session = await verifyWorkspaceSession(token, secret);
      return {
        subject: session.principalId,
        tenantId: session.tenantId,
        roles: session.roles,
      };
    },
  };
}

function secretBytes(secret: string): Uint8Array {
  const bytes = new TextEncoder().encode(secret);
  if (bytes.byteLength < 32) {
    throw new Error("Workspace session secret must be at least 32 bytes.");
  }
  return bytes;
}
