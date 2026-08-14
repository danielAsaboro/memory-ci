import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "pg";

const migrationDirectory = fileURLToPath(new URL("../../db/migrations", import.meta.url));

export async function migrate(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl, application_name: "memory-ci-migrate" });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name STRING PRIMARY KEY,
        checksum STRING NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      const sql = await readFile(path.join(migrationDirectory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [file],
      );

      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          throw new Error(`Applied migration ${file} has a different checksum.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, checksum]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
