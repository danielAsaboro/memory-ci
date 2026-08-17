import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";

import { createRouter } from "../src/api/router";
import { createWorkspaceSessionVerifier } from "../src/auth/workspace-session";
import { createPool, withTenantTransaction } from "../src/db/client";
import { CandidateRepository } from "../src/db/candidates";
import { EvaluationRepository } from "../src/db/evaluations";
import { migrate } from "../src/db/migrate";
import { bootstrapWorkspace } from "../src/services/bootstrap-workspace";
import { evaluateCandidate } from "../src/services/evaluate-candidate";
import { selectScenarios } from "../src/services/select-scenarios";
import { createApiServices } from "../src/lambda/services";
import { judgeBehavioralDiffWithBedrock } from "../src/aws/bedrock";
import { runSandboxTrajectory } from "../src/lambda/sandbox";

const apiPort = Number(process.env.STASH_E2E_API_PORT ?? "3011");
const secret = process.env.STASH_SESSION_SECRET ?? "stash-e2e-session-secret-that-is-at-least-32-bytes";
const bootstrapKey = process.env.STASH_BOOTSTRAP_KEY ?? "stash-e2e-bootstrap-key";
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `stash_e2e_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => { const url = new URL(adminUrl); url.pathname = `/${databaseName}`; return url.toString(); })();
const vector = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;

const admin = new Client({ connectionString: adminUrl });
const pool = createPool(databaseUrl);
let draining = false;
let artifactDirectory = "";

async function seedScenario(tenantId: string, namespaceId: string) {
  await withTenantTransaction(pool, tenantId, async ({ client }) => {
    await client.query(
      `INSERT INTO evaluation_scenarios
       (tenant_id,id,namespace_id,name,input_payload,assertions,expected_tool_constraints,embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::VECTOR)
       ON CONFLICT (tenant_id,namespace_id,name) DO NOTHING`,
      [tenantId, randomUUID(), namespaceId, "E2E refund destination", { caseId: "e2e-refund", amount: 75, currency: "USD", destination: "original" },
        { disposition: "approve", approvalRequired: false, refused: false },
        { toolName: "issue_sandbox_refund", arguments: { caseId: "e2e-refund", amount: 75, currency: "USD", destination: "original" } }, vector],
    );
  });
}

async function drainEvaluations() {
  if (draining) return;
  draining = true;
  try {
    const events = await pool.query<{ tenant_id: string; id: string; aggregate_id: string }>(
      `SELECT tenant_id,id,aggregate_id FROM outbox_events
       WHERE event_type='candidate.evaluation_requested' AND delivered_at IS NULL
       ORDER BY created_at,id`,
    );
    for (const event of events.rows) {
      try {
        await withTenantTransaction(pool, event.tenant_id, async (transaction) => evaluateCandidate(
          { tenantId: event.tenant_id, principalId: "stash-e2e-provider", requestId: event.id }, event.aggregate_id,
          {
            candidates: new CandidateRepository(transaction),
            namespaces: { currentRevision: async (namespaceId) => {
              const result = await transaction.client.query<{ current_revision: string }>("SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2", [event.tenant_id, namespaceId]);
              return Number(result.rows[0]!.current_revision);
            } },
            scenarios: { select: (candidateId, limit) => selectScenarios(transaction, candidateId, limit) },
            evaluations: new EvaluationRepository(transaction),
            trajectories: { run: (scenario, revision) => runSandboxTrajectory({ tenantId: event.tenant_id, candidateId: event.aggregate_id, memoryRevision: revision.kind === "baseline" ? revision.revision : 1, scenario, revision }) },
            semanticJudge: async (input) => {
              const candidate = await transaction.client.query<{ canonical_text: string }>("SELECT canonical_text FROM memory_candidates WHERE tenant_id=$1 AND id=$2", [event.tenant_id, event.aggregate_id]);
              return candidate.rows[0]?.canonical_text.includes("e2e-provider-timeout-marker")
                ? { status: "inconclusive" as const, errorCode: "timeout" as const, modelId: "e2e-bedrock-adapter", providerRequestId: "e2e-bedrock-timeout" }
                : judgeBehavioralDiffWithBedrock(input, { modelId: "e2e-bedrock-adapter", transport: { async converse(request) {
                  const payload = JSON.parse(String(request.messages?.[0]?.content?.[0] && "text" in request.messages[0].content[0] ? request.messages[0].content[0].text : "{}")) as { behavioralDiff?: { hasBehavioralChange?: boolean } };
                  const status = payload.behavioralDiff?.hasBehavioralChange ? "regressed" : "passed";
                  return { $metadata: { requestId: `e2e-bedrock-${event.id}` }, output: { message: { content: [{ toolUse: { name: "record_semantic_judgment", input: { status, reason: status === "passed" ? "Local adapter found no behavioral regression." : "Local adapter found a behavioral regression.", confidence: 1 } } }] } } };
                } } });
            },
            artifacts: { put: async (input) => { const path = join(artifactDirectory, `${input.digest}.json`); await writeFile(path, input.body, "utf8"); return `http://127.0.0.1:${apiPort}/e2e/artifacts/${input.digest}.json`; } },
            policyVersion: "e2e-v1", modelId: "e2e-bedrock-adapter", triggerEventId: event.id, id: randomUUID,
          },
        ));
        await pool.query("UPDATE outbox_events SET delivered_at=now(),provider_event_id=$2,attempts=attempts+1 WHERE tenant_id=$1 AND id=$3", [event.tenant_id, `e2e-event-${event.id}`, event.id]);
      } catch (error) {
        await pool.query("UPDATE outbox_events SET attempts=attempts+1,last_error_code=$3,available_at=now() + INTERVAL '1 second' WHERE tenant_id=$1 AND id=$2", [event.tenant_id, event.id, error instanceof Error ? error.name : "e2e_provider_error"]);
      }
    }
  } finally { draining = false; }
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function respond(response: ServerResponse, upstream: Response) {
  response.statusCode = upstream.status;
  upstream.headers.forEach((value, key) => response.setHeader(key, value));
  const payload = Buffer.from(await upstream.arrayBuffer());
  response.end(payload);
}

export async function startE2eApi() {
  let databaseCreated = false;
  let server: ReturnType<typeof createServer> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return; cleaned = true;
    if (interval) clearInterval(interval);
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await pool.end().catch(() => undefined);
    if (artifactDirectory) await rm(artifactDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS ${databaseName} CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  };
  try {
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`); databaseCreated = true;
  artifactDirectory = await mkdtemp(join(tmpdir(), "stash-e2e-artifacts-"));
  await migrate(databaseUrl);
  const services = createApiServices(pool);
  const router = createRouter({
    auth: createWorkspaceSessionVerifier(secret),
    membership: { hasMembership: async (principalId, tenantId) => Boolean((await pool.query("SELECT id FROM principals WHERE tenant_id=$1 AND id=$2", [tenantId, principalId])).rows[0]) },
    services,
    requestId: randomUUID,
  });
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${apiPort}`);
    if (url.pathname === "/health") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ status: "ok" })); return; }
    if (url.pathname.startsWith("/e2e/artifacts/") && request.method === "GET") { try { response.setHeader("content-type", "application/json"); response.end(await readFile(join(artifactDirectory, url.pathname.split("/").at(-1)!), "utf8")); } catch { response.statusCode = 404; response.end(); } return; }
    if (url.pathname === "/v1/workspaces" && request.method === "POST") {
      if (request.headers["x-stash-bootstrap-key"] !== bootstrapKey) { response.statusCode = 401; response.end(JSON.stringify({ code: "unauthorized" })); return; }
      const parsed = JSON.parse((await body(request)) || "{}");
      const workspace = await bootstrapWorkspace(pool, { idempotencyKey: String(request.headers["idempotency-key"] ?? randomUUID()), displayName: typeof parsed.displayName === "string" ? parsed.displayName : "Stash E2E workspace" });
      await seedScenario(workspace.tenantId, workspace.namespaceId);
      response.statusCode = 201; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(workspace)); return;
    }
    const requestBody = ["GET", "HEAD"].includes(request.method ?? "GET") ? undefined : await body(request);
    await respond(response, await router(new Request(url, { method: request.method, headers: request.headers as Record<string, string>, body: requestBody })));
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(apiPort, "127.0.0.1", () => { server!.off("error", reject); resolve(); });
  });
  interval = setInterval(() => { void drainEvaluations(); }, 100);
  return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
