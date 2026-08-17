import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

export type AuditViolation = Readonly<{
  ruleId: "CANONICAL_ORIGIN" | "CLIENT_SECRET" | "DEMO_COPY" | "PUBLIC_ENV_SECRET" | "SECURITY_HEADERS" | "SERVER_API_URL" | "SOURCE_MAP_SECRET";
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
const clientSecret = /(?:AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|STASH_SESSION_SECRET|STASH_BOOTSTRAP_KEY|BEGIN(?: [A-Z]+)? PRIVATE KEY|(?:postgres(?:ql)?:\/\/)[^\s"']+)/i;

export async function auditProduction(root = process.cwd(), environment: NodeJS.ProcessEnv = process.env): Promise<ProductionAudit> {
  const violations: AuditViolation[] = [];
  const sourceFiles = await collectFiles(root, ["app", "src"], (path) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path));
  const buildFiles = await collectFiles(root, [".next/static", ".next/build-manifest.json", ".next/app-build-manifest.json", ".next/server/app-paths-manifest.json"], (path) => !path.endsWith(".map"));
  const sourceMaps = await collectFiles(root, [".next/static"], (path) => path.endsWith(".map"));
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

  const documentation = await readEnvironmentFile(join(root, ".env.example"));
  const effective = environment.NODE_ENV === "production" ? await effectiveProductionEnvironment(root, environment) : documentation;
  if (effective.NEXT_PUBLIC_APP_URL !== canonicalOrigin) add(violations, "CANONICAL_ORIGIN", root, join(root, ".env.example"), `${environment.NODE_ENV === "production" ? "Effective production" : "Documented"} NEXT_PUBLIC_APP_URL must equal ${canonicalOrigin}.`);
  if (!isProductionApiEndpoint(effective.STASH_API_BASE_URL)) add(violations, "SERVER_API_URL", root, join(root, ".env.example"), `${environment.NODE_ENV === "production" ? "Effective production" : "Documented"} STASH_API_BASE_URL must be an approved production HTTPS endpoint.`);

  for (const file of sourceMaps) {
    const contents = await readFile(file, "utf8").catch(() => "");
    if (clientSecret.test(contents)) add(violations, "SOURCE_MAP_SECRET", root, file, "A source map contains a secret-shaped value.");
  }

  for (const file of buildFiles) {
    const contents = await readFile(file, "utf8").catch(() => "");
    if (clientSecret.test(contents)) add(violations, "CLIENT_SECRET", root, file, "A client artifact contains a server secret pattern.");
  }

  const headerRules = await configuredHeaderRules(root);
  const requiredHeaders: Readonly<Record<string, (value: string) => boolean>> = {
    "content-security-policy": isProductionContentSecurityPolicy,
    "referrer-policy": (value) => value === "strict-origin-when-cross-origin",
    "x-content-type-options": (value) => value === "nosniff",
    "permissions-policy": (value) => value.length > 0,
    "strict-transport-security": hasProductionHsts,
  };
  const missing = headerRules.flatMap((headers) => Object.entries(requiredHeaders).filter(([key, accepts]) => !headers.some((header) => header.key.toLowerCase() === key && accepts(header.value))).map(([key]) => key));
  if (headerRules.length === 0 || missing.length > 0) add(violations, "SECURITY_HEADERS", root, await nextConfigPath(root) ?? join(root, "next.config.ts"), `Missing or unsafe response headers: ${unique(missing.length ? missing : Object.keys(requiredHeaders)).join(", ")}.`);

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
  return entries.filter((entry) => entry.isFile() && [".env", ".env.example", ".env.local", ".env.production", ".env.production.local"].includes(entry.name)).map((entry) => join(root, entry.name));
}

async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  const contents = await readFile(path, "utf8").catch(() => "");
  for (const match of contents.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/gm)) values[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
  return values;
}

async function effectiveProductionEnvironment(root: string, environment: NodeJS.ProcessEnv): Promise<Record<string, string | undefined>> {
  const effective: Record<string, string | undefined> = {};
  for (const name of [".env", ".env.production", ".env.local", ".env.production.local"]) Object.assign(effective, await readEnvironmentFile(join(root, name)));
  for (const key of ["NEXT_PUBLIC_APP_URL", "STASH_API_BASE_URL"]) if (environment[key] !== undefined) effective[key] = environment[key];
  return effective;
}

type Header = Readonly<{ key: string; value: string }>;

async function configuredHeaderRules(root: string): Promise<Header[][]> {
  const configPath = await nextConfigPath(root);
  if (!configPath) return [];
  try {
    const configModule = await import(`${pathToFileURL(configPath).href}?audit=${Date.now()}`);
    const config = typeof configModule.default === "function" ? await configModule.default() : await configModule.default;
    const rules: unknown = typeof config?.headers === "function" ? await config.headers() : [];
    return Array.isArray(rules) ? rules.map((rule) => {
      const headers = typeof rule === "object" && rule !== null && "headers" in rule ? rule.headers : undefined;
      return Array.isArray(headers) ? headers.filter(isHeader) : [];
    }) : [];
  } catch {
    return [];
  }
}

function isProductionApiEndpoint(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "api.trystash.xyz" || /\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/i.test(url.hostname));
  } catch { return false; }
}

function isProductionContentSecurityPolicy(value: string): boolean {
  const directives = new Map(value.split(";").map((directive) => directive.trim()).filter(Boolean).map((directive) => {
    const [name, ...sources] = directive.split(/\s+/);
    return [name, sources] as const;
  }));
  const defaultSources = directives.get("default-src") ?? [];
  const scriptSources = directives.get("script-src") ?? [];
  const weakScriptSource = scriptSources.some((source) => source === "*" || /^(?:https?|data|blob):$/i.test(source) || source === "'unsafe-inline'" || source === "'unsafe-eval'");
  return defaultSources.length === 1 && defaultSources[0] === "'self'"
    && scriptSources.includes("'self'")
    && scriptSources.some((source) => source === "'strict-dynamic'" || /^'nonce-[^']+'$/.test(source) || /^'sha(?:256|384|512)-[^']+'$/.test(source))
    && !weakScriptSource;
}

function hasProductionHsts(value: string): boolean {
  const maxAge = value.match(/(?:^|;)\s*max-age=(\d+)\s*(?:;|$)/i)?.[1];
  return Boolean(maxAge && /^\d+$/.test(maxAge) && Number(maxAge) >= 31_536_000);
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
