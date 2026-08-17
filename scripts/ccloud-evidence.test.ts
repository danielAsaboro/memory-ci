import { describe, expect, it } from "vitest";

import { selectCloudCluster } from "./ccloud-evidence";

describe("ccloud production evidence", () => {
  it("selects only the requested ready CockroachDB Cloud cluster from structured JSON", () => {
    expect(selectCloudCluster({ clusters: [{ id: "cluster-1", provider: "AWS", region: "us-east-1", plan: "BASIC", state: "ACTIVE", sqlHost: "cluster-1.aws-us-east-1.cockroachlabs.cloud" }] }, "cluster-1")).toMatchObject({ id: "cluster-1", provider: "AWS", region: "us-east-1" });
  });

  it("rejects opaque CLI output, fixtures, non-AWS regions, and inactive clusters", () => {
    expect(() => selectCloudCluster("not-json", "cluster-1")).toThrow(/structured/i);
    expect(() => selectCloudCluster({ clusters: [{ id: "fixture-cluster", provider: "AWS", region: "us-east-1", plan: "BASIC", state: "ACTIVE", sqlHost: "fixture.aws-us-east-1.cockroachlabs.cloud" }] }, "fixture-cluster")).toThrow(/fixture/i);
    expect(() => selectCloudCluster({ clusters: [{ id: "cluster-1", provider: "GCP", region: "us-east-1", plan: "BASIC", state: "ACTIVE", sqlHost: "cluster-1.aws-us-east-1.cockroachlabs.cloud" }] }, "cluster-1")).toThrow(/provider/i);
  });
});
