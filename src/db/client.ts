import { Pool, type PoolClient } from "pg";

const serializationFailure = "40001";

export type TenantTransaction = Readonly<{
  tenantId: string;
  client: PoolClient;
}>;

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "memory-ci",
  });
}

export async function withTenantTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (transaction: TenantTransaction) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  if (!tenantId) throw new Error("tenantId is required");

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const result = await operation({ tenantId, client });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
      if (code !== serializationFailure || attempt === maxAttempts) throw error;
    } finally {
      client.release();
    }
  }

  throw new Error("unreachable transaction retry state");
}
