import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export type AuditViolation = Readonly<{
  ruleId: "CANONICAL_ORIGIN" | "DEMO_COPY" | "PUBLIC_ENV_SECRET" | "SECURITY_HEADERS" | "SOURCE_MAP_SECRET";
  path: string;
  message: string;
}>;

export type ProductionAudit = Readonly<{
  ok: boolean;
  violations: readonly AuditViolation[];
}>;

const canonicalOrigin = "https://trystash.xyz";
const permittedPublicEnvironmentKeys = new Set(["NEXT_PUBLIC_APP_URL"]);
const demoCopy = /chatgpt\.site|sandbox fixture/i;
const sourceMapSecret = /(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|BEGIN(?: [A-Z]+)? PRIVATE KEY|(?:postgres(?:ql)?:\/\/)[^\s"']+)/i;

export async function auditProduction(root = process.cwd()): Promise<ProductionAudit> {
  const violations: AuditViolation[] = [];
  const sourceFiles = await collectFiles(root, ["app", "src"], (path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const buildFiles = await collectFiles(root, [".next/static/chunks", ".next/server", ".next"], (path) => !path.endsWith(".map"));
  const sourceMaps = await collectFiles(root, [".next"], (path) => path.endsWith(".map"));
  const environmentFiles = await rootEnvironmentFiles(root);

  for (const file of unique([...sourceFiles, ...buildFiles])) {
    const contents = await readFile(file, "utf8").catch(() => "");
    if (demoCopy.test(contents)) add(violations, "DEMO_COPY", root, file, "Retired demo copy is present in a production source or artifact.");
    for (const key of contents.match(/\bNEXT_PUBLIC_[A-Z0-9_]+\b/g) ?? []) {
      if (!permittedPublicEnvironmentKeys.has(key)) add(violations, "PUBLIC_ENV_SECRET", root, file, `${key} must not be exposed to browser code.`);
    }
  }

  for (const file of environmentFiles) {
    const contents = await readFile(file, "utf8").catch(() => "");
    for (const line of contents.split(/\r?\n/)) {
      const key = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=/)?.[1];
      if (key && !permittedPublicEnvironmentKeys.has(key)) add(violations, "PUBLIC_ENV_SECRET", root, file, `${key} must not be exposed to browser code.`);
    }
  }

  const configuredOrigin = await environmentValue(environmentFiles, "NEXT_PUBLIC_APP_URL");
  if (configuredOrigin !== canonicalOrigin) {
    add(violations, "CANONICAL_ORIGIN", root, join(root, ".env.example"), `NEXT_PUBLIC_APP_URL must equal ${canonicalOrigin}.`);
  }

  for (const file of sourceMaps) {
    const contents = await readFile(file, "utf8").catch(() => "");
    if (sourceMapSecret.test(contents)) add(violations, "SOURCE_MAP_SECRET", root, file, "A source map contains a secret-shaped value.");
  }

  const headers = await configuredHeaders(root);
  const requiredHeaders: Readonly<Record<string, (value: string) => boolean>> = {
    "content-security-policy": (value) => value.includes("default-src"),
    "referrer-policy": (value) => value === "strict-origin-when-cross-origin",
    "x-content-type-options": (value) => value === "nosniff",
    "permissions-policy": (value) => value.length > 0,
    "strict-transport-security": (value) => /max-age=\d+/.test(value),
  };
  const missing = Object.entries(requiredHeaders).filter(([key, accepts]) => !headers.some((header) => header.key.toLowerCase() === key && accepts(header.value))).map(([key]) => key);
  if (missing.length > 0) add(violations, "SECURITY_HEADERS", root, await nextConfigPath(root) ?? join(root, "next.config.ts"), `Missing or unsafe response headers: ${missing.join(", ")}.`);

  const sorted = violations.sort((left, right) => `${left.ruleId}:${left.path}:${left.message}`.localeCompare(`${right.ruleId}:${right.path}:${right.message}`));
  return { ok: sorted.length === 0, violations: sorted };
}

function add(violations: AuditViolation[], ruleId: AuditViolation["ruleId"], root: string, path: string, message: string) {
  const normalizedPath = relative(root, path) || basename(path);
  if (!violations.some((violation) => violation.ruleId === ruleId && violation.path === normalizedPath && violation.message === message)) {
    violations.push({ ruleId, path: normalizedPath, message });
  }
}

async function collectFiles(root: string, directories: readonly string[], include: (path: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  for (const directory of unique(directories.map((directory) => join(root, directory)))) await walk(directory, files, include);
  return files;
}

async function walk(path: string, files: string[], include: (path: string) => boolean): Promise<void> {
  const details = await stat(path).catch(() => null);
  if (!details) return;
  if (details.isFile()) { if (include(path)) files.push(path); return; }
  for (const entry of await readdir(path, { withFileTypes: true })) await walk(join(path, entry.name), files, include);
}

async function rootEnvironmentFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile() && entry.name.startsWith(".env")).map((entry) => join(root, entry.name));
}

async function environmentValue(files: readonly string[], key: string): Promise<string | undefined> {
  for (const file of files) {
    const match = (await readFile(file, "utf8")).match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
    if (match) return match[1].replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

type Header = Readonly<{ key: string; value: string }>;

async function configuredHeaders(root: string): Promise<Header[]> {
  const configPath = await nextConfigPath(root);
  if (!configPath) return [];
  try {
    const configModule = await import(`${pathToFileURL(configPath).href}?audit=${Date.now()}`);
    const config = typeof configModule.default === "function" ? await configModule.default() : await configModule.default;
    const rules: unknown = typeof config?.headers === "function" ? await config.headers() : [];
    return Array.isArray(rules) ? rules.flatMap((rule) => {
      const headers = typeof rule === "object" && rule !== null && "headers" in rule ? rule.headers : undefined;
      return Array.isArray(headers) ? headers.filter(isHeader) : [];
    }) : [];
  } catch {
    return [];
  }
}

async function nextConfigPath(root: string): Promise<string | undefined> {
  for (const name of ["next.config.ts", "next.config.mjs", "next.config.js"]) {
    const path = join(root, name);
    if (await stat(path).then((details) => details.isFile()).catch(() => false)) return path;
  }
  return undefined;
}

function unique<T>(items: readonly T[]): T[] { return [...new Set(items)]; }

function isHeader(value: unknown): value is Header {
  return typeof value === "object" && value !== null && "key" in value && "value" in value
    && typeof value.key === "string" && typeof value.value === "string";
}

const invokedAsScript = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) {
  const report = await auditProduction();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}
