import { describe, expect, it } from "vitest";

import { validateHealthResponse, validateWorkspaceResponse } from "./aws-smoke";

describe("AWS production smoke parsing", () => {
  it("accepts only the live health response contract", () => {
    expect(validateHealthResponse({ status: "ok", requestId: "gateway-request-1" })).toEqual({ status: "ok", requestId: "gateway-request-1" });
    expect(() => validateHealthResponse({ status: "ok" })).toThrow(/health/i);
  });

  it("requires the retry to return the same persisted workspace identity", () => {
    const workspace = { tenantId: "tenant-1", principalId: "principal-1", workspaceName: "Stash smoke", roles: ["admin", "reviewer"] };
    expect(validateWorkspaceResponse(workspace, workspace)).toEqual({ first: workspace, retry: workspace });
    expect(() => validateWorkspaceResponse(workspace, { ...workspace, principalId: "principal-2" })).toThrow(/persistence/i);
  });
});
