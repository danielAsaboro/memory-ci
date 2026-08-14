import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { createCognitoVerifier } from "./auth";
import { createRouter, type ApiDependencies, type ApiServices } from "./router";

const claims = { subject: "user-1", tenantId: "tenant-1", roles: ["reviewer"] };

function services(overrides: Partial<ApiServices> = {}): ApiServices {
  const success = async () => ({ ok: true });
  return {
    createCandidate: success, listCandidates: success, getCandidate: success,
    screenCandidate: success, evaluateCandidate: success, reviewCandidate: success,
    promoteCandidate: success, rollbackLineage: success, searchMemory: success,
    explainMemory: success, namespaceRevision: success, getEvaluation: success,
    listAudit: success, integrationsStatus: success, demoReset: success,
    demoPoisonAttempt: success, demoPolicyUpdate: success,
    ...overrides,
  };
}

function dependencies(overrides: Partial<ApiDependencies> = {}): ApiDependencies {
  return {
    auth: { async verify() { return claims; } },
    membership: { async hasMembership(subject, tenantId) { return subject === "user-1" && tenantId === "tenant-1"; } },
    services: services(),
    requestId: () => "request-test-1",
    ...overrides,
  };
}

const request = (path: string, init: RequestInit = {}) => new Request(`https://api.memoryci.dev${path}`, {
  ...init,
  headers: { authorization: "Bearer valid-token", "content-type": "application/json", ...init.headers },
});

describe("Cognito verifier", () => {
  let token: string;
  let verifier: ReturnType<typeof createCognitoVerifier>;
  let wrongAudienceVerifier: ReturnType<typeof createCognitoVerifier>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = await exportJWK(publicKey);
    const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example";
    token = await new SignJWT({ "custom:tenant_id": "tenant-1", "cognito:groups": ["reviewer"] })
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .setSubject("user-1").setIssuer(issuer).setAudience("client-1").setIssuedAt().setExpirationTime("5m")
      .sign(privateKey);
    const jwks = { keys: [{ ...jwk, kid: "key-1", alg: "RS256", use: "sig" }] };
    verifier = createCognitoVerifier({ issuer, audience: "client-1", jwks });
    wrongAudienceVerifier = createCognitoVerifier({ issuer, audience: "another-client", jwks });
  });

  it("accepts signed tenant claims and rejects a wrong audience", async () => {
    await expect(verifier.verify(token)).resolves.toEqual({ subject: "user-1", tenantId: "tenant-1", roles: ["reviewer"] });
    await expect(wrongAudienceVerifier.verify(token)).rejects.toThrow();
  });
});

describe("Memory CI API router", () => {
  it("requires bearer authentication and tenant membership", async () => {
    const router = createRouter(dependencies());
    const missing = await router(new Request("https://api.memoryci.dev/v1/candidates"));
    expect(missing.status).toBe(401);

    const forbiddenRouter = createRouter(dependencies({ membership: { async hasMembership() { return false; } } }));
    const forbidden = await forbiddenRouter(request("/v1/candidates"));
    expect(forbidden.status).toBe(403);
  });

  it("rejects unknown fields and missing idempotency keys before service execution", async () => {
    let calls = 0;
    const router = createRouter(dependencies({ services: services({ createCandidate: async () => { calls += 1; return {}; } }) }));
    const unknown = await router(request("/v1/candidates", {
      method: "POST", headers: { "idempotency-key": "create-1" },
      body: JSON.stringify({ namespaceId: "33333333-3333-4333-8333-333333333333", memoryClass: "policy",
        trustClass: "authoritative", canonicalText: "Policy", payload: {}, source: {}, surprise: true }),
    }));
    expect(unknown.status).toBe(400);
    const noKey = await router(request("/v1/candidates", { method: "POST", body: "{}" }));
    expect(noKey.status).toBe(400);
    expect(calls).toBe(0);
  });

  it("routes validated candidate creation with explicit tenant context and request receipts", async () => {
    let captured: unknown;
    const router = createRouter(dependencies({
      services: services({ createCandidate: async (context, input) => { captured = { context, input }; return { id: "candidate-1", state: "proposed" }; } }),
    }));
    const response = await router(request("/v1/candidates", {
      method: "POST", headers: { "idempotency-key": "create-1" }, body: JSON.stringify({
        namespaceId: "33333333-3333-4333-8333-333333333333", memoryClass: "policy", trustClass: "authoritative",
        canonicalText: "Refunds above $150 require review.", payload: { threshold: 150 },
        source: { id: "44444444-4444-4444-8444-444444444444", sourceType: "operator",
          content: "Signed refund policy update.", contentDigest: "a".repeat(64), signatureVerified: true },
      }),
    }));
    expect(response.status).toBe(202);
    expect(response.headers.get("x-request-id")).toBe("request-test-1");
    expect(captured).toMatchObject({
      context: { tenantId: "tenant-1", principalId: "user-1", requestId: "request-test-1" },
      input: { idempotencyKey: "create-1" },
    });
  });

  it("covers every documented route and returns 404 for unknown paths", async () => {
    const router = createRouter(dependencies());
    const routes: Array<[string, string, unknown?]> = [
      ["GET", "/v1/candidates"], ["GET", "/v1/candidates/candidate-1"],
      ["POST", "/v1/candidates/candidate-1/screen", {}], ["POST", "/v1/candidates/candidate-1/evaluate", {}],
      ["POST", "/v1/candidates/candidate-1/reviews", { evaluationRunId: "run-1", decision: "approved", reason: "safe" }],
      ["POST", "/v1/candidates/candidate-1/promote", { reviewId: "review-1", stableKey: "refunds", reason: "safe" }],
      ["POST", "/v1/lineages/lineage-1/rollback", { targetVersionId: "version-1", reason: "regression" }],
      ["POST", "/v1/memory/search", { namespaceId: "namespace-1", query: "refund", purpose: "support" }],
      ["GET", "/v1/memory/memory-1/explain"], ["GET", "/v1/namespaces/namespace-1/revision"],
      ["GET", "/v1/evaluations/run-1"], ["GET", "/v1/audit"], ["GET", "/v1/integrations/status"],
      ["POST", "/v1/demo/reset", {}], ["POST", "/v1/demo/poison-attempt", {}], ["POST", "/v1/demo/policy-update", {}],
    ];
    for (const [method, path, body] of routes) {
      const response = await router(request(path, {
        method, headers: method === "POST" ? { "idempotency-key": `key-${path}` } : undefined,
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      expect(response.status, `${method} ${path}`).toBeLessThan(400);
    }
    expect((await router(request("/v1/not-real"))).status).toBe(404);
  });

  it("maps typed errors without leaking raw secrets", async () => {
    const router = createRouter(dependencies({ services: services({
      listCandidates: async () => { throw Object.assign(new Error("password=raw-secret"), { code: "provider_unavailable" }); },
    }) }));
    const response = await router(request("/v1/candidates"));
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(503);
    expect(body).toEqual({ code: "provider_unavailable", message: "A required provider is unavailable.", requestId: "request-test-1" });
    expect(JSON.stringify(body)).not.toContain("raw-secret");
  });
});
