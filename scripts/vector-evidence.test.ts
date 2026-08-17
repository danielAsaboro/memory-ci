import { describe, expect, it } from "vitest";

import { assertProductionVectorConfiguration } from "./vector-evidence";

describe("production vector evidence configuration", () => {
  it("rejects local database URLs even if a cluster ID was supplied", () => {
    expect(() => assertProductionVectorConfiguration({
      STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cluster-1", DATABASE_URL: "postgresql://root@127.0.0.1:26258/stash?sslmode=disable",
    })).toThrow(/local/i);
  });

  it("requires an explicit Cloud cluster ID before labeling evidence production", () => {
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", DATABASE_URL: "postgresql://user@host.cockroachlabs.cloud:26257/stash?sslmode=verify-full" })).toThrow(/COCKROACH_CLUSTER_ID/);
  });
});
