import { describe, expect, it } from "vitest";

import { validateEmbeddingResponse, validateHealthResponse, validateWorkspaceResponse } from "./aws-smoke";

describe("AWS production smoke parsing", () => {
  it("accepts only the live health response contract", () => {
    expect(validateHealthResponse({ status: "ok", requestId: "gateway-request-1" })).toEqual({ status: "ok", requestId: "gateway-request-1" });
    expect(() => validateHealthResponse({ status: "ok" })).toThrow(/health/i);
  });

  it("rejects a managed embedding result unless it has exactly 1024 finite numeric values and a provider request ID", () => {
    expect(validateEmbeddingResponse({ embedding: Array.from({ length: 1024 }, () => 0.01) }, "embed-request-1", "amazon.titan-embed-text-v2:0")).toMatchObject({ dimensions: 1024, providerRequestId: "embed-request-1" });
    expect(() => validateEmbeddingResponse({ embedding: [1, 2] }, "embed-request-1", "amazon.titan-embed-text-v2:0")).toThrow(/1024/i);
    expect(() => validateEmbeddingResponse({ embedding: Array.from({ length: 1024 }, () => 0) }, "", "amazon.titan-embed-text-v2:0")).toThrow(/request/i);
  });

  it("requires the retry to return the same persisted workspace identity", () => {
    const workspace = { tenantId: "tenant-1", principalId: "principal-1", workspaceName: "Stash smoke", roles: ["admin", "reviewer"] };
    expect(validateWorkspaceResponse(workspace, workspace)).toEqual({ first: workspace, retry: workspace });
    expect(() => validateWorkspaceResponse(workspace, { ...workspace, principalId: "principal-2" })).toThrow(/persistence/i);
  });
});
