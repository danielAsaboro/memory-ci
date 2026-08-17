import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPool, withTenantTransaction } from "../db/client";
import { migrate } from "../db/migrate";
import { bootstrapWorkspace } from "./bootstrap-workspace";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `stash_bootstrap_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

let admin: Client;
const pool = createPool(databaseUrl);

function lookupBarrierPool(): Pool {
  let lookups = 0;
  let release: (() => void) | undefined;
  const bothLookupsStarted = new Promise<void>((resolve) => { release = resolve; });

  return {
    connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client) as unknown as (...args: unknown[]) => Promise<unknown>;
      let firstLookup = true;
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property !== "query") return Reflect.get(target, property, receiver);
          return async (...args: unknown[]) => {
            const statement = args[0];
            const text = typeof statement === "string" ? statement :
              typeof statement === "object" && statement !== null && "text" in statement ? String(statement.text) : "";
            if (firstLookup && text.includes("FROM workspace_bootstraps")) {
              firstLookup = false;
              lookups += 1;
              if (lookups === 2) release?.();
              if (lookups <= 2) await bothLookupsStarted;
            }
            return query(...args);
          };
        },
      }) as PoolClient;
    },
  } as Pool;
}

function serializationFailureOncePool(): Pool {
  let failed = false;
  return {
    connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client) as unknown as (...args: unknown[]) => Promise<unknown>;
      return new Proxy(client, {
        get(target, property, receiver) {
          if (property !== "query") return Reflect.get(target, property, receiver);
          return async (...args: unknown[]) => {
            const statement = args[0];
            if (!failed && typeof statement === "string" && statement.startsWith("INSERT INTO tenants")) {
              failed = true;
              throw Object.assign(new Error("restart transaction"), { code: "40001" });
            }
            return query(...args);
          };
        },
      }) as PoolClient;
    },
  } as Pool;
}

async function counts(tenantId: string) {
  return withTenantTransaction(pool, tenantId, async ({ client }) => {
    const result = await client.query<{ table_name: string; count: string }>(
      `SELECT table_name, count
       FROM (
         SELECT 'principals' AS table_name, count(*)::STRING AS count FROM principals WHERE tenant_id=$1
         UNION ALL SELECT 'agent_namespaces', count(*)::STRING FROM agent_namespaces WHERE tenant_id=$1
         UNION ALL SELECT 'sources', count(*)::STRING FROM sources WHERE tenant_id=$1
         UNION ALL SELECT 'memory_candidates', count(*)::STRING FROM memory_candidates WHERE tenant_id=$1
         UNION ALL SELECT 'memory_lineages', count(*)::STRING FROM memory_lineages WHERE tenant_id=$1
         UNION ALL SELECT 'memory_versions', count(*)::STRING FROM memory_versions WHERE tenant_id=$1
         UNION ALL SELECT 'audit_events', count(*)::STRING FROM audit_events WHERE tenant_id=$1
       ) ORDER BY table_name`,
      [tenantId],
    );
    return Object.fromEntries(result.rows.map((row) => [row.table_name, Number(row.count)]));
  });
}

describe("workspace bootstrap", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
    await admin?.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin?.end();
  });

  it("persists one signed Northstar starter workspace and its immutable creation audit event", async () => {
    const workspace = await bootstrapWorkspace(pool, {
      idempotencyKey: "bootstrap-northstar-1",
      displayName: "Northstar Support",
    });

    expect(workspace).toMatchObject({
      workspaceName: "Northstar Support",
      roles: ["admin", "reviewer"],
    });

    const persisted = await withTenantTransaction(pool, workspace.tenantId, async ({ client }) => ({
      tenant: await client.query("SELECT id,name FROM tenants WHERE id=$1", [workspace.tenantId]),
      owner: await client.query("SELECT id,kind,display_name FROM principals WHERE tenant_id=$1 AND id=$2", [workspace.tenantId, workspace.principalId]),
      agent: await client.query("SELECT id,kind,display_name FROM principals WHERE tenant_id=$1 AND id=$2", [workspace.tenantId, workspace.agentId]),
      namespace: await client.query("SELECT id,current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2", [workspace.tenantId, workspace.namespaceId]),
      starter: await client.query<{
        active: boolean; revision: string; signature_verified: boolean; canonical_text: string; state: string;
      }>(`SELECT v.active,v.revision,s.signature_verified,v.canonical_text,c.state
          FROM memory_versions v
          JOIN sources s ON s.tenant_id=v.tenant_id AND s.id=(SELECT source_id FROM memory_candidates c WHERE c.tenant_id=v.tenant_id AND c.id=v.candidate_id)
          JOIN memory_candidates c ON c.tenant_id=v.tenant_id AND c.id=v.candidate_id
          WHERE v.tenant_id=$1 AND v.namespace_id=$2`, [workspace.tenantId, workspace.namespaceId]),
      audit: await client.query<{ action: string; previous_event_digest: string | null }>(
        "SELECT action,previous_event_digest FROM audit_events WHERE tenant_id=$1", [workspace.tenantId],
      ),
      evaluationRuns: await client.query("SELECT id FROM evaluation_runs WHERE tenant_id=$1", [workspace.tenantId]),
      quarantined: await client.query("SELECT id FROM memory_candidates WHERE tenant_id=$1 AND state='quarantined'", [workspace.tenantId]),
    }));

    expect(persisted.tenant.rows[0]).toMatchObject({ id: workspace.tenantId, name: "Northstar Support" });
    expect(persisted.owner.rows[0]).toMatchObject({ id: workspace.principalId, kind: "human", display_name: "Northstar Support" });
    expect(persisted.agent.rows[0]).toMatchObject({ id: workspace.agentId, kind: "agent" });
    expect(persisted.namespace.rows[0]).toMatchObject({ id: workspace.namespaceId, current_revision: "1" });
    expect(persisted.starter.rows[0]).toMatchObject({ active: true, revision: "1", signature_verified: true, state: "active" });
    expect(persisted.starter.rows[0]?.canonical_text).toMatch(/Northstar/i);
    expect(persisted.audit.rows).toEqual([{ action: "workspace.created", previous_event_digest: null }]);
    expect(persisted.evaluationRuns.rows).toEqual([]);
    expect(persisted.quarantined.rows).toEqual([]);
  });

  it("returns the original workspace without duplicate records for an idempotent retry", async () => {
    const first = await bootstrapWorkspace(pool, { idempotencyKey: "bootstrap-retry-1", displayName: "Retry Workspace" });
    const before = await counts(first.tenantId);
    const repeated = await bootstrapWorkspace(pool, { idempotencyKey: "bootstrap-retry-1", displayName: "Changed Name" });

    expect(repeated).toEqual(first);
    await expect(counts(first.tenantId)).resolves.toEqual(before);
  });

  it("converges two simultaneous first calls after both tenant-bound lookups start", async () => {
    const input = { idempotencyKey: "bootstrap-concurrent-1", displayName: "Concurrent Workspace" };
    const gatedPool = lookupBarrierPool();
    const [first, second] = await Promise.all([
      bootstrapWorkspace(gatedPool, input),
      bootstrapWorkspace(gatedPool, input),
    ]);

    expect(second).toEqual(first);
    await expect(counts(first.tenantId)).resolves.toEqual({
      agent_namespaces: 1, audit_events: 1, memory_candidates: 1, memory_lineages: 1,
      memory_versions: 1, principals: 2, sources: 1,
    });
  });

  it("retries a Cockroach serialization failure without creating a partial workspace", async () => {
    const workspace = await bootstrapWorkspace(serializationFailureOncePool(), {
      idempotencyKey: "bootstrap-serialization-retry-1",
      displayName: "Retried Workspace",
    });

    await expect(counts(workspace.tenantId)).resolves.toEqual({
      agent_namespaces: 1, audit_events: 1, memory_candidates: 1, memory_lineages: 1,
      memory_versions: 1, principals: 2, sources: 1,
    });
  });

  it("isolates a different bootstrap key in a separate tenant", async () => {
    const first = await bootstrapWorkspace(pool, { idempotencyKey: "bootstrap-isolated-1", displayName: "First Workspace" });
    const second = await bootstrapWorkspace(pool, { idempotencyKey: "bootstrap-isolated-2", displayName: "Second Workspace" });

    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.principalId).not.toBe(first.principalId);
    await expect(counts(first.tenantId)).resolves.toEqual({
      agent_namespaces: 1, audit_events: 1, memory_candidates: 1, memory_lineages: 1,
      memory_versions: 1, principals: 2, sources: 1,
    });
    await expect(counts(second.tenantId)).resolves.toEqual({
      agent_namespaces: 1, audit_events: 1, memory_candidates: 1, memory_lineages: 1,
      memory_versions: 1, principals: 2, sources: 1,
    });
  });
});
