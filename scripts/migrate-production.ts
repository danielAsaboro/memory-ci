import { pathToFileURL } from "node:url";

import { migrate } from "../src/db/migrate";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required; migrations refuse a local default for production use.");
  await migrate(databaseUrl);
  process.stdout.write("Applied migrations through 011_harden_legacy_elevated_provenance.sql.\n");
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Migration failed."}\n`); process.exitCode = 1; });
