import { describe, expect, it } from "vitest";

import { selectCloudCluster } from "./ccloud-evidence";

describe("ccloud production evidence", () => {
  it("selects only the requested ready CockroachDB Cloud cluster from structured JSON", () => {
    expect(selectCloudCluster([{ id: "cluster-1", cloud_provider: "AWS", regions: [{ name: "us-east-1", sql_dns: "cluster-1.aws-us-east-1.cockroachlabs.cloud" }], sql_dns: "cluster-1.aws-us-east-1.cockroachlabs.cloud", plan: "BASIC", state: "CREATED" }], "cluster-1", "org-1")).toMatchObject({ id: "cluster-1", organizationId: "org-1", provider: "AWS", region: "us-east-1" });
  });

  it("rejects opaque CLI output, fixtures, non-AWS regions, and inactive clusters", () => {
    const cluster = (overrides: Record<string, unknown> = {}) => [{ id: "cluster-1", cloud_provider: "AWS", regions: [{ name: "us-east-1", sql_dns: "cluster-1.aws-us-east-1.cockroachlabs.cloud" }], sql_dns: "cluster-1.aws-us-east-1.cockroachlabs.cloud", plan: "BASIC", state: "CREATED", ...overrides }];
    expect(() => selectCloudCluster("not-json", "cluster-1", "org-1")).toThrow(/structured/i);
    expect(() => selectCloudCluster(cluster({ id: "fixture-cluster" }), "fixture-cluster", "org-1")).toThrow(/fixture/i);
    expect(() => selectCloudCluster(cluster({ cloud_provider: "GCP" }), "cluster-1", "org-1")).toThrow(/provider/i);
    expect(() => selectCloudCluster(cluster({ state: "NOT_READY" }), "cluster-1", "org-1")).toThrow(/ready/i);
  });
});
