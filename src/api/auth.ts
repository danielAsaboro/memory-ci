import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

import { DomainError } from "../domain/errors";

export type AuthClaims = Readonly<{ subject: string; tenantId: string; roles: readonly string[] }>;
export interface AuthVerifier { verify(token: string): Promise<AuthClaims> }

export function createCognitoVerifier(input: {
  issuer: string;
  audience: string;
  jwks: JSONWebKeySet;
}): AuthVerifier {
  const keySet = createLocalJWKSet(input.jwks);
  return {
    async verify(token: string): Promise<AuthClaims> {
      const verified = await jwtVerify(token, keySet, {
        issuer: input.issuer,
        audience: input.audience,
        algorithms: ["RS256"],
      });
      const tenantId = verified.payload["custom:tenant_id"];
      const groups = verified.payload["cognito:groups"];
      if (!verified.payload.sub || typeof tenantId !== "string") {
        throw new DomainError("unauthorized", "Authenticated token is missing required tenant claims.");
      }
      return {
        subject: verified.payload.sub,
        tenantId,
        roles: Array.isArray(groups) ? groups.filter((role): role is string => typeof role === "string") : [],
      };
    },
  };
}

export function readBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    throw new DomainError("unauthorized", "Bearer authentication is required.");
  }
  return authorization.slice(7);
}
