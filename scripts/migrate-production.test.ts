import { describe, expect, it } from "vitest";

import { assertCloudDatabaseUrl, assertMigrationLedger, assertSqlClusterIdentity } from "./migrate-production";

describe("production migration preflight", () => {
  it("rejects private, self-hosted, and insecure database targets", () => {
    expect(() => assertCloudDatabaseUrl("postgresql://root@10.0.0.2:26257/stash?sslmode=verify-full")).toThrow(/CockroachDB Cloud/i);
    expect(() => assertCloudDatabaseUrl("postgresql://root@cluster.aws-us-east-1.cockroachlabs.cloud:26257/stash?sslmode=disable")).toThrow(/secure/i);
  });

  it("requires the exact dynamically discovered migration ledger set", () => {
    expect(() => assertMigrationLedger(["001.sql", "002.sql"], ["001.sql"])).toThrow(/migration/i);
    expect(() => assertMigrationLedger(["001.sql", "002.sql"], ["001.sql", "002.sql"])).not.toThrow();
  });

  it("checks SQL cluster identity before a migration caller may mutate", async () => {
    const calls: string[] = [];
    await expect(assertSqlClusterIdentity({ query: async (sql) => {
      calls.push(sql);
      return { rows: sql.startsWith("SELECT") ? [{ cluster_id: "wrong" }] : [] };
    } }, "sql-cluster-1")).rejects.toThrow(/identity/i);
    expect(calls).toEqual([
      "SET allow_unsafe_internals = on",
      "SELECT crdb_internal.cluster_id() AS cluster_id",
    ]);
  });
});
