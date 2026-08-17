import { readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

import { Client } from "pg";

import { migrate } from "../src/db/migrate";
import { safeErrorMessage } from "./evidence-contract";

export function assertCloudDatabaseUrl(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("DATABASE_URL must target CockroachDB Cloud."); }
  if (!/\.cockroachlabs\.cloud$/i.test(url.hostname) || /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error("DATABASE_URL must target a public CockroachDB Cloud hostname.");
  if (url.searchParams.get("sslmode") === "disable") throw new Error("DATABASE_URL must use secure TLS verification.");
}

export function assertMigrationLedger(expected: readonly string[], applied: readonly string[]): void {
  if (expected.length === 0 || expected.length !== applied.length || expected.some((name, index) => name !== applied[index])) throw new Error("Migration ledger does not contain the exact expected migration set.");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required; migrations refuse a local default for production use.");
  assertCloudDatabaseUrl(databaseUrl);
  const expected = (await readdir(path.join(process.cwd(), "db/migrations"))).filter((file) => file.endsWith(".sql")).sort((left, right) => left.localeCompare(right));
  await migrate(databaseUrl);
  const client = new Client({ connectionString: databaseUrl, application_name: "stash-production-migration-ledger" });
  await client.connect();
  try {
    const applied = await client.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    assertMigrationLedger(expected, applied.rows.map((row) => row.name));
  } finally { await client.end(); }
  process.stdout.write(`Applied and verified ${expected.length} migrations.\n`);
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${safeErrorMessage(error)}\n`); process.exitCode = 1; });
