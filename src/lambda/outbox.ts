import { randomUUID } from "node:crypto";

import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";

import { resolveDatabaseConnectionString } from "../aws/database-secret";
import { judgeBehavioralDiffWithBedrock } from "../aws/bedrock";
import { AwsSdkEventBridgeTransport, publishMemoryEvent, type EventBridgeTransport } from "../aws/eventbridge";
import { AwsSdkS3Transport, putArtifact } from "../aws/s3";
import { CandidateRepository } from "../db/candidates";
import { createPool } from "../db/client";
import { withTenantTransaction } from "../db/client";
import { EvaluationRepository } from "../db/evaluations";
import { claimPendingOutboxEvents, markOutboxFailure } from "../db/outbox";
import { evaluateCandidate } from "../services/evaluate-candidate";
import { selectScenarios } from "../services/select-scenarios";
import { runSandboxTrajectory } from "./sandbox";

let poolPromise: ReturnType<typeof createRuntimePool> | undefined;
async function createRuntimePool() { return createPool(await resolveDatabaseConnectionString()); }

async function executeEvaluation(pool: Awaited<ReturnType<typeof createRuntimePool>>, event: { tenantId: string; aggregateId: string; id: string }) {
  const bucket = process.env.EVIDENCE_BUCKET;
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!bucket || !modelId) throw new Error("EVIDENCE_BUCKET and BEDROCK_MODEL_ID are required for evaluation dispatch.");
  const s3 = new AwsSdkS3Transport(new S3Client({ region: process.env.AWS_REGION }));
  const semanticJudge = (input: { scenarioName: string; behavioralDiff: unknown }) => judgeBehavioralDiffWithBedrock(input, { modelId, region: process.env.AWS_REGION });
  const completed = await pool.query<{ id: string; candidate_id: string; status: "passed" | "regressed" | "inconclusive" }>(
    `SELECT id,candidate_id,status FROM evaluation_runs
     WHERE tenant_id=$1 AND trigger_event_id=$2 AND status IN ('passed','regressed','inconclusive')`, [event.tenantId, event.id],
  );
  if (completed.rows[0]) return;
  await withTenantTransaction(pool, event.tenantId, async (transaction) => evaluateCandidate(
    { tenantId: event.tenantId, principalId: "stash-outbox", requestId: event.id }, event.aggregateId,
    {
      candidates: new CandidateRepository(transaction),
      namespaces: { currentRevision: async (namespaceId) => {
        const result = await transaction.client.query<{ current_revision: string }>("SELECT current_revision FROM agent_namespaces WHERE tenant_id=$1 AND id=$2", [event.tenantId, namespaceId]);
        if (!result.rows[0]) throw new Error("Evaluation namespace was not found."); return Number(result.rows[0].current_revision);
      } },
      scenarios: { select: (candidateId, limit) => selectScenarios(transaction, candidateId, limit) }, evaluations: new EvaluationRepository(transaction),
      trajectories: { run: async (scenario, revision) => runSandboxTrajectory({ tenantId: event.tenantId, candidateId: event.aggregateId, memoryRevision: revision.kind === "baseline" ? revision.revision : 1, scenario, revision }) },
      semanticJudge,
      artifacts: { put: async (input) => (await putArtifact(s3, bucket, input)).uri },
      policyVersion: process.env.EVALUATION_POLICY_VERSION ?? "v1", modelId, triggerEventId: event.id, id: randomUUID,
    },
  ));
}

export async function dispatchOutboxEvents(pool: Pool, transport: EventBridgeTransport, eventBusName: string, execute = executeEvaluation) {
  const client = await pool.connect();
  let delivered = 0;
  let failed = 0;
  try {
    await client.query("BEGIN");
    const events = await claimPendingOutboxEvents(client, 100);
    for (const event of events) {
      try {
        if (event.eventType === "candidate.evaluation_requested") {
          const terminal = await client.query("SELECT 1 FROM evaluation_runs WHERE tenant_id=$1 AND trigger_event_id=$2 AND status IN ('passed','regressed','inconclusive')", [event.tenantId, event.id]);
          if (!terminal.rows[0]) await execute(pool, event);
        }
        const published = await publishMemoryEvent(transport, eventBusName, {
          id: event.id, tenantId: event.tenantId, type: event.eventType,
          aggregateId: event.aggregateId, occurredAt: new Date().toISOString(),
          traceId: randomUUID(), payload: event.payload,
        });
        await client.query(
          "UPDATE outbox_events SET delivered_at=now(),provider_event_id=$2,attempts=attempts+1 WHERE id=$1 AND delivered_at IS NULL",
          [event.id, published.eventId],
        );
        delivered += 1;
      } catch (error) {
        failed += 1;
        const code = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "publish_failed";
        await markOutboxFailure(client, event.id, code);
      }
    }
    await client.query("COMMIT");
    return { status: failed ? "partial" : "ok", delivered, failed };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function handler() {
  const pool = await (poolPromise ??= createRuntimePool());
  const eventBusName = process.env.EVENT_BUS_NAME;
  if (!eventBusName) throw new Error("EVENT_BUS_NAME is required");
  return dispatchOutboxEvents(pool, new AwsSdkEventBridgeTransport(new EventBridgeClient({ region: process.env.AWS_REGION })), eventBusName);
}
