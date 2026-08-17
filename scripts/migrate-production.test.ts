import { describe, expect, it } from "vitest";

import { assertCloudDatabaseUrl, assertMigrationLedger } from "./migrate-production";

describe("production migration preflight", () => {
  it("rejects private, self-hosted, and insecure database targets", () => {
    expect(() => assertCloudDatabaseUrl("postgresql://root@10.0.0.2:26257/stash?sslmode=verify-full")).toThrow(/CockroachDB Cloud/i);
    expect(() => assertCloudDatabaseUrl("postgresql://root@cluster.aws-us-east-1.cockroachlabs.cloud:26257/stash?sslmode=disable")).toThrow(/secure/i);
  });

  it("requires the exact dynamically discovered migration ledger set", () => {
    expect(() => assertMigrationLedger(["001.sql", "002.sql"], ["001.sql"])).toThrow(/migration/i);
    expect(() => assertMigrationLedger(["001.sql", "002.sql"], ["001.sql", "002.sql"])).not.toThrow();
  });
});
