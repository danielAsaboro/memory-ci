import { describe, expect, it } from "vitest";

import { assertProductionVectorConfiguration, selectReadyVectorIndexJob } from "./vector-evidence";

describe("production vector evidence configuration", () => {
  it("rejects local database URLs even if a cluster ID was supplied", () => {
    expect(() => assertProductionVectorConfiguration({
      STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cluster-1", DATABASE_URL: "postgresql://root@127.0.0.1:26258/stash?sslmode=disable",
    })).toThrow(/local/i);
  });

  it("requires an explicit Cloud cluster ID before labeling evidence production", () => {
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", DATABASE_URL: "postgresql://user@host.cockroachlabs.cloud:26257/stash?sslmode=verify-full" })).toThrow(/COCKROACH_CLUSTER_ID/);
  });

  it("rejects private-network and non-Cockroach Cloud database hosts", () => {
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cluster-1", DATABASE_URL: "postgresql://user@10.0.0.5:26257/stash?sslmode=verify-full" })).toThrow(/Cloud/i);
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cluster-1", DATABASE_URL: "postgresql://user@db.example.test:26257/stash?sslmode=verify-full" })).toThrow(/Cloud/i);
  });

  it("accepts only the latest exact succeeded vector-index schema job", () => {
    const jobs = [{ job_id: "1", status: "succeeded", finished: "2026-08-17T17:00:00Z", description: "CREATE VECTOR INDEX memory_versions_embedding_idx ON public.memory_versions" }];
    expect(selectReadyVectorIndexJob(jobs, "memory_versions_embedding_idx", "memory_versions")).toMatchObject({ job_id: "1", status: "succeeded" });
    for (const status of ["running", "paused", "failed", "canceled", "reverting"]) expect(() => selectReadyVectorIndexJob([{ ...jobs[0], status }], "memory_versions_embedding_idx", "memory_versions")).toThrow(/succeeded/i);
    expect(() => selectReadyVectorIndexJob([{ ...jobs[0], description: "CREATE VECTOR INDEX other_idx ON memory_versions" }], "memory_versions_embedding_idx", "memory_versions")).toThrow(/rerun/i);
  });
});
