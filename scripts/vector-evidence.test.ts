import { describe, expect, it } from "vitest";

import { assertProductionVectorConfiguration, hasVectorIndexDefinition, loadFullVectorIndexJobs, selectReadyVectorIndexJob } from "./vector-evidence";

describe("production vector evidence configuration", () => {
  it("rejects local database URLs even if a cluster ID was supplied", () => {
    expect(() => assertProductionVectorConfiguration({
      STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cloud-cluster-1", COCKROACH_SQL_CLUSTER_ID: "sql-cluster-1", DATABASE_URL: "postgresql://root@127.0.0.1:26258/stash?sslmode=disable",
    })).toThrow(/local/i);
  });

  it("requires an explicit Cloud cluster ID before labeling evidence production", () => {
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cloud-cluster-1", DATABASE_URL: "postgresql://user@host.cockroachlabs.cloud:26257/stash?sslmode=verify-full" })).toThrow(/COCKROACH_SQL_CLUSTER_ID/);
  });

  it("rejects private-network and non-Cockroach Cloud database hosts", () => {
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cloud-cluster-1", COCKROACH_SQL_CLUSTER_ID: "sql-cluster-1", DATABASE_URL: "postgresql://user@10.0.0.5:26257/stash?sslmode=verify-full" })).toThrow(/Cloud/i);
    expect(() => assertProductionVectorConfiguration({ STASH_PRODUCTION_EVIDENCE: "1", COCKROACH_CLUSTER_ID: "cloud-cluster-1", COCKROACH_SQL_CLUSTER_ID: "sql-cluster-1", DATABASE_URL: "postgresql://user@db.example.test:26257/stash?sslmode=verify-full" })).toThrow(/Cloud/i);
  });

  it("accepts only the latest exact succeeded vector-index schema job", () => {
    const jobs = [{ job_id: "1", status: "succeeded", finished: "2026-08-17T17:00:00Z", description: "CREATE VECTOR INDEX IF NOT EXISTS memory_versions_embedding_idx ON memory_versions (embedding vector_cosine_ops)" }];
    expect(selectReadyVectorIndexJob(jobs, "memory_versions_embedding_idx", "memory_versions")).toMatchObject({ job_id: "1", status: "succeeded" });
    for (const status of ["running", "paused", "failed", "canceled", "reverting"]) expect(() => selectReadyVectorIndexJob([{ ...jobs[0], status }], "memory_versions_embedding_idx", "memory_versions")).toThrow(/succeeded/i);
    expect(() => selectReadyVectorIndexJob([{ ...jobs[0], description: "CREATE VECTOR INDEX other_idx ON memory_versions" }], "memory_versions_embedding_idx", "memory_versions")).toThrow(/rerun/i);
  });

  it("rejects an archive table whose name merely extends the target table token", () => {
    const archiveJob = [{ job_id: "2", status: "succeeded", finished: "2026-08-17T17:00:00Z", description: "CREATE VECTOR INDEX memory_versions_embedding_idx ON public.memory_versions_archive (embedding)" }];
    expect(() => selectReadyVectorIndexJob(archiveJob, "memory_versions_embedding_idx", "memory_versions")).toThrow(/rerun/i);
  });

  it("loads the full retained job description before exact table correlation", async () => {
    const queries: string[] = [];
    const rows = await loadFullVectorIndexJobs({ query: async (sql) => {
      queries.push(sql);
      return { rows: [{ job_id: "123", status: "succeeded", finished: "2026-08-17T17:00:00Z", description: "CREATE VECTOR INDEX IF NOT EXISTS memory_versions_embedding_idx ON stash.public.memory_versions (embedding vector_cosine_ops)" }] };
    } }, [{ job_id: "123", status: "succeeded", finished: "2026-08-17T17:00:00Z", description: "CREATE VECTOR INDEX IF NOT EXISTS memory_versions_embedding … ne_ops)" }]);
    expect(queries).toEqual(["SHOW JOB 123"]);
    expect(selectReadyVectorIndexJob(rows, "memory_versions_embedding_idx", "memory_versions", "stash")).toMatchObject({ job_id: "123" });
  });

  it("recognizes the canonical vector-index clause returned by SHOW CREATE TABLE", () => {
    const ddl = "CREATE TABLE public.memory_versions (\n  embedding VECTOR(1024),\n  VECTOR INDEX memory_versions_active_embedding_idx (tenant_id, namespace_id, active, embedding vector_cosine_ops)\n)";
    expect(hasVectorIndexDefinition(ddl, "memory_versions_active_embedding_idx")).toBe(true);
    expect(hasVectorIndexDefinition(ddl, "memory_versions_embedding_idx")).toBe(false);
  });
});
