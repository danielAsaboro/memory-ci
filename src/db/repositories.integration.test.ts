import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuditRepository } from "./audit";
import { CandidateRepository } from "./candidates";
import { createPool, withTenantTransaction } from "./client";
import { EvaluationRepository } from "./evaluations";
import { MemoryRepository } from "./memories";
import { LifecycleReceiptRepository } from "./lifecycle-receipts";
import { migrate } from "./migrate";
import { OutboxRepository } from "./outbox";
import { ReviewRepository } from "./reviews";
import { createApiServices } from "../lambda/services";
import { dispatchOutboxEvents } from "../lambda/outbox";
import type { EventBridgeTransport } from "../aws/eventbridge";
import { canonicalSourceSignaturePayload, verifyPersistedSourceSignature } from "../services/source-signature";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `memory_ci_repositories_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
})();

const vector = (value: number) => `[${Array.from({ length: 1024 }, () => value).join(",")}]`;

type Seed = Readonly<{
  tenantId: string;
  principalId: string;
  namespaceId: string;
  sourceId: string;
}>;

let admin: Client;
const pool = createPool(databaseUrl);

async function seed(slug: string): Promise<Seed> {
  const tenantId = randomUUID();
  const principalId = randomUUID();
  const namespaceId = randomUUID();
  const sourceId = randomUUID();

  await withTenantTransaction(pool, tenantId, async ({ client }) => {
    await client.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [tenantId, slug, slug]);
    await client.query(
      "INSERT INTO principals (tenant_id, id, kind, display_name) VALUES ($1, $2, 'human', 'Reviewer')",
      [tenantId, principalId],
    );
    await client.query(
      "INSERT INTO agent_namespaces (tenant_id, id, slug, name) VALUES ($1, $2, 'refunds', 'Refunds')",
      [tenantId, namespaceId],
    );
    await client.query(
      `INSERT INTO sources
       (tenant_id, id, source_type, trust_class, content_digest, submitted_by, signature_verified)
       VALUES ($1, $2, 'operator', 'authoritative', $3, $4, true)`,
      [tenantId, sourceId, `source-${slug}`, principalId],
    );
  });

  return { tenantId, principalId, namespaceId, sourceId };
}

async function createCandidate(seedData: Seed, digest: string, idempotencyKey: string) {
  return withTenantTransaction(pool, seedData.tenantId, async (transaction) => {
    const repository = new CandidateRepository(transaction);
    return repository.create({
      id: randomUUID(),
      namespaceId: seedData.namespaceId,
      lineageId: null,
      state: "proposed",
      memoryClass: "policy",
      trustClass: "authoritative",
      canonicalPayload: { refundReviewThreshold: 150 },
      canonicalText: "Refunds above $150 require review.",
      contentDigest: digest,
      sourceId: seedData.sourceId,
      createdBy: seedData.principalId,
      embedding: vector(0.1),
      idempotencyKey,
    });
  });
}

describe("tenant-bound repositories", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin.end();
  });

  it("isolates tenants, makes create idempotent, and changes state without rewriting payload", async () => {
    const first = await seed(`first-${randomUUID()}`);
    const second = await seed(`second-${randomUUID()}`);
    const created = await createCandidate(first, "digest-isolated", "candidate-request-1");

    const repeated = await withTenantTransaction(pool, first.tenantId, async (transaction) =>
      new CandidateRepository(transaction).create({
        id: randomUUID(),
        namespaceId: first.namespaceId,
        lineageId: null,
        state: "proposed",
        memoryClass: "policy",
        trustClass: "authoritative",
        canonicalPayload: { refundReviewThreshold: 150 },
        canonicalText: "Refunds above $150 require review.",
        contentDigest: "digest-isolated",
        sourceId: first.sourceId,
        createdBy: first.principalId,
        embedding: vector(0.1),
        idempotencyKey: "candidate-request-1",
      }),
    );

    const hidden = await withTenantTransaction(pool, second.tenantId, async (transaction) =>
      new CandidateRepository(transaction).get(created.id),
    );
    const transitioned = await withTenantTransaction(pool, first.tenantId, async (transaction) =>
      new CandidateRepository(transaction).transition(created.id, "screening"),
    );

    expect(repeated.id).toBe(created.id);
    expect(hidden).toBeNull();
    expect(transitioned.state).toBe("screening");
    expect(transitioned.canonicalPayload).toEqual({ refundReviewThreshold: 150 });
  });

  it("keeps source evidence immutable while permitting exact tenant-local reuse", async () => {
    const first = await seed(`immutable-first-${randomUUID()}`); const second = await seed(`immutable-second-${randomUUID()}`);
    const sourceId = randomUUID(); const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const priorKeys = process.env.STASH_TRUSTED_SOURCE_KEYS;
    process.env.STASH_TRUSTED_SOURCE_KEYS = JSON.stringify([{ identity: "immutable-owner", keyId: "v1", publicKey }]);
    try {
      const services = createApiServices(pool);
      const sourceContent = "Immutable signed evidence for refund policy.";
      const signed = sign(null, Buffer.from(canonicalSourceSignaturePayload({ content: sourceContent, signatureIdentity: "immutable-owner", signatureKeyId: "v1" })), keys.privateKey).toString("base64");
      const makeInput = (namespaceId: string, canonicalText: string, content = sourceContent, signature = signed) => ({
        namespaceId, memoryClass: "policy", trustClass: "authoritative", canonicalText, payload: { canonicalText }, idempotencyKey: randomUUID(),
        source: { id: sourceId, sourceType: "operator", content, contentDigest: createHash("sha256").update(content).digest("hex"), signatureIdentity: "immutable-owner", signatureKeyId: "v1", signatureAlgorithm: "ed25519" as const, signature },
      });
      const firstContext = { tenantId: first.tenantId, principalId: first.principalId, requestId: randomUUID(), roles: ["admin"] };
      const secondContext = { tenantId: second.tenantId, principalId: second.principalId, requestId: randomUUID(), roles: ["admin"] };
      const historical = await services.createCandidate(firstContext, makeInput(first.namespaceId, "First immutable candidate"));
      await expect(services.createCandidate(firstContext, makeInput(first.namespaceId, "Exact evidence reuse candidate"))).resolves.toMatchObject({ state: "proposed" });
      const changed = "Attacker replacement evidence";
      const changedSignature = sign(null, Buffer.from(canonicalSourceSignaturePayload({ content: changed, signatureIdentity: "immutable-owner", signatureKeyId: "v1" })), keys.privateKey).toString("base64");
      await expect(services.createCandidate(firstContext, makeInput(first.namespaceId, "Malicious overwrite", changed, changedSignature))).rejects.toMatchObject({ code: "conflict" });
      await expect(services.createCandidate(secondContext, makeInput(second.namespaceId, "Independent tenant candidate"))).resolves.toMatchObject({ state: "proposed" });
      const source = await pool.query<{ canonical_signed_payload: string; signature: string; signature_algorithm: string; signature_public_key: string; content_digest: string }>("SELECT canonical_signed_payload,signature,signature_algorithm,signature_public_key,content_digest FROM sources WHERE tenant_id=$1 AND id=$2", [first.tenantId, sourceId]);
      expect(source.rows).toHaveLength(1);
      expect(source.rows[0]?.content_digest).toBe(createHash("sha256").update(sourceContent).digest("hex"));
      expect(verifyPersistedSourceSignature({ canonicalPayload: source.rows[0]!.canonical_signed_payload, signature: source.rows[0]!.signature, signatureAlgorithm: source.rows[0]!.signature_algorithm, publicKey: source.rows[0]!.signature_public_key })).toBe(true);
      await expect(withTenantTransaction(pool, first.tenantId, (transaction) => new CandidateRepository(transaction).get((historical as { id: string }).id))).resolves.toMatchObject({ id: (historical as { id: string }).id });
    } finally { if (priorKeys === undefined) delete process.env.STASH_TRUSTED_SOURCE_KEYS; else process.env.STASH_TRUSTED_SOURCE_KEYS = priorKeys; }
  });

  it("deduplicates concurrent evaluation requests with different lifecycle keys", async () => {
    const seeded = await seed(`evaluation-dedup-${randomUUID()}`);
    const candidate = await createCandidate(seeded, "dedup-digest", "dedup-candidate");
    await withTenantTransaction(pool, seeded.tenantId, (transaction) => new CandidateRepository(transaction).transition(candidate.id, "screening").then(() => new CandidateRepository(transaction).transition(candidate.id, "evaluating")));
    const services = createApiServices(pool); const context = { tenantId: seeded.tenantId, principalId: seeded.principalId, requestId: "dedup-request", roles: ["admin"] };
    const start = Promise.resolve();
    const [first, second] = await Promise.all([
      start.then(() => services.evaluateCandidate(context, { candidateId: candidate.id, idempotencyKey: "evaluate-key-a" })),
      start.then(() => services.evaluateCandidate(context, { candidateId: candidate.id, idempotencyKey: "evaluate-key-b" })),
    ]);
    expect(first).toMatchObject({ candidateId: candidate.id, status: "queued" }); expect(second).toMatchObject({ eventId: (first as { eventId: string }).eventId });
    const rows = await pool.query<{ count: string }>("SELECT count(*) FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 AND event_type='candidate.evaluation_requested'", [seeded.tenantId, candidate.id]);
    expect(rows.rows[0]?.count).toBe("1");
    await expect(services.evaluateCandidate(context, { candidateId: candidate.id, idempotencyKey: "evaluate-key-a" })).resolves.toEqual(first);
    await expect(services.evaluateCandidate(context, { candidateId: candidate.id, idempotencyKey: "evaluate-key-b" })).resolves.toEqual(second);
  });

  it("retries EventBridge publication after terminal evidence without reevaluating", async () => {
    await pool.query("UPDATE outbox_events SET delivered_at=now() WHERE delivered_at IS NULL");
    const seeded = await seed(`outbox-replay-${randomUUID()}`); const candidate = await createCandidate(seeded, "outbox-digest", "outbox-candidate");
    await pool.query("UPDATE outbox_events SET delivered_at=now() WHERE tenant_id=$1 AND aggregate_id=$2", [seeded.tenantId, candidate.id]);
    await withTenantTransaction(pool, seeded.tenantId, async (transaction) => { const candidates = new CandidateRepository(transaction); await candidates.transition(candidate.id, "screening"); await candidates.transition(candidate.id, "evaluating"); });
    const event = await withTenantTransaction(pool, seeded.tenantId, (transaction) => new OutboxRepository(transaction).enqueue({ eventType: "candidate.evaluation_requested", aggregateType: "memory_candidate", aggregateId: candidate.id, payload: { candidateId: candidate.id } }));
    await pool.query("UPDATE outbox_events SET available_at=now() - INTERVAL '1 second' WHERE tenant_id=$1 AND id=$2", [seeded.tenantId, event.id]);
    const eligible = await pool.query<{ count: string }>("SELECT count(*) FROM outbox_events WHERE id=$1 AND delivered_at IS NULL AND available_at <= now()", [event.id]); expect(eligible.rows[0]?.count).toBe("1");
    const calls = { sandbox: 0, bedrock: 0, s3: 0, complete: 0, published: [] as string[] };
    const execute = async (runtimePool: typeof pool, item: { tenantId: string; aggregateId: string; id: string }) => withTenantTransaction(runtimePool, item.tenantId, async (transaction) => {
      calls.sandbox += 1; calls.bedrock += 1; calls.s3 += 1; const evaluations = new EvaluationRepository(transaction); const run = await evaluations.createRun({ id: randomUUID(), candidateId: item.aggregateId, baselineRevision: 0, policyVersion: "v1", triggerEventId: item.id });
      await evaluations.recordResult({ id: randomUUID(), runId: run.id, scope: "suite", status: "passed", baselineTrajectory: { status: "not_executed", reason: "no_scenarios" }, candidateTrajectory: { status: "not_executed", reason: "no_scenarios" }, behavioralDiff: {}, deterministicAssertions: { passed: true }, artifactUri: "s3://evidence/terminal.json", providerRequestId: "bedrock-trace" });
      await evaluations.completeRun(run.id, "passed", { modelId: "bedrock", providerRequestId: "bedrock-trace" }); calls.complete += 1; await new CandidateRepository(transaction).transition(item.aggregateId, "review_required");
    });
    const failing: EventBridgeTransport = { async putEvents(input) { calls.published.push(JSON.parse(String(input.Entries?.[0]?.Detail)).eventId); throw new Error("EventBridge unavailable"); } };
    await expect(dispatchOutboxEvents(pool, failing, "bus", execute)).resolves.toMatchObject({ failed: 1, delivered: 0 });
    const undelivered = await pool.query<{ delivered_at: Date | null }>("SELECT delivered_at FROM outbox_events WHERE tenant_id=$1 AND id=$2", [seeded.tenantId, event.id]); expect(undelivered.rows[0]?.delivered_at).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const succeeding: EventBridgeTransport = { async putEvents(input) { calls.published.push(JSON.parse(String(input.Entries?.[0]?.Detail)).eventId); return { FailedEntryCount: 0, Entries: [{ EventId: "provider-event" }], $metadata: { requestId: "publish-request", httpStatusCode: 200 } }; } };
    await expect(dispatchOutboxEvents(pool, succeeding, "bus", execute)).resolves.toMatchObject({ failed: 0, delivered: 1 });
    expect(calls).toMatchObject({ sandbox: 1, bedrock: 1, s3: 1, complete: 1, published: [event.id, event.id] });
    const terminal = await pool.query<{ status: string; provider_request_id: string; delivered_at: Date | null }>("SELECT r.status,r.provider_request_id,o.delivered_at FROM evaluation_runs r JOIN outbox_events o ON o.tenant_id=r.tenant_id AND o.id=r.trigger_event_id WHERE r.tenant_id=$1 AND r.trigger_event_id=$2", [seeded.tenantId, event.id]);
    expect(terminal.rows).toEqual([expect.objectContaining({ status: "passed", provider_request_id: "bedrock-trace", delivered_at: expect.any(Date) })]);
  });

  it("binds reviews to fresh evidence and atomically promotes, supersedes, reads history, and rolls back", async () => {
    const seeded = await seed(`promotion-${randomUUID()}`);
    const firstCandidate = await createCandidate(seeded, "digest-v1", "candidate-v1");

    const firstResult = await withTenantTransaction(pool, seeded.tenantId, async (transaction) => {
      const candidates = new CandidateRepository(transaction);
      const evaluations = new EvaluationRepository(transaction);
      const reviews = new ReviewRepository(transaction);
      const memories = new MemoryRepository(transaction);

      await candidates.transition(firstCandidate.id, "screening");
      await candidates.transition(firstCandidate.id, "evaluating");
      const run = await evaluations.createRun({
        id: randomUUID(), candidateId: firstCandidate.id, baselineRevision: 0, policyVersion: "policy-v1",
      });
      await evaluations.completeRun(run.id, "passed", { modelId: "bedrock-test", providerRequestId: "aws-1" });
      await candidates.transition(firstCandidate.id, "review_required");
      const review = await reviews.decide({
        id: randomUUID(), candidateId: firstCandidate.id, reviewerId: seeded.principalId,
        decision: "approved", candidateDigest: "digest-v1", evaluationRunId: run.id,
        baselineRevision: 0, policyVersion: "policy-v1", reason: "Safe policy update",
      });
      await candidates.transition(firstCandidate.id, "approved");
      await reviews.assertFresh(firstCandidate.id, review.id);
      return memories.promote({
        candidateId: firstCandidate.id, reviewId: review.id, actorId: seeded.principalId,
        stableKey: "refund-review-threshold", reason: "Initial activation", idempotencyKey: "promote-v1",
      });
    });

    const secondCandidate = await createCandidate(seeded, "digest-v2", "candidate-v2");
    const secondResult = await withTenantTransaction(pool, seeded.tenantId, async (transaction) => {
      const candidates = new CandidateRepository(transaction);
      const evaluations = new EvaluationRepository(transaction);
      const reviews = new ReviewRepository(transaction);
      const memories = new MemoryRepository(transaction);

      await candidates.transition(secondCandidate.id, "screening");
      await candidates.transition(secondCandidate.id, "evaluating");
      const run = await evaluations.createRun({
        id: randomUUID(), candidateId: secondCandidate.id, baselineRevision: 1, policyVersion: "policy-v1",
      });
      await evaluations.completeRun(run.id, "passed", { modelId: "bedrock-test", providerRequestId: "aws-2" });
      await candidates.transition(secondCandidate.id, "review_required");
      const review = await reviews.decide({
        id: randomUUID(), candidateId: secondCandidate.id, reviewerId: seeded.principalId,
        decision: "approved", candidateDigest: "digest-v2", evaluationRunId: run.id,
        baselineRevision: 1, policyVersion: "policy-v1", reason: "Raise threshold",
      });
      await candidates.transition(secondCandidate.id, "approved");
      return memories.promote({
        candidateId: secondCandidate.id, reviewId: review.id, actorId: seeded.principalId,
        stableKey: "refund-review-threshold", reason: "Second activation", idempotencyKey: "promote-v2",
      });
    });

    const history = await withTenantTransaction(pool, seeded.tenantId, async (transaction) => {
      const memories = new MemoryRepository(transaction);
      const atOne = await memories.getActiveAtRevision(seeded.namespaceId, 1);
      const atTwo = await memories.getActiveAtRevision(seeded.namespaceId, 2);
      const rolledBack = await memories.rollback({
        lineageId: secondResult.lineageId,
        targetVersionId: firstResult.id,
        actorId: seeded.principalId,
        reason: "Regression detected",
        idempotencyKey: "rollback-to-v1",
      });
      return { atOne, atTwo, rolledBack };
    });

    expect(firstResult.revision).toBe(1);
    expect(secondResult.revision).toBe(2);
    expect(history.atOne.map((item) => item.contentDigest)).toContain("digest-v1");
    expect(history.atTwo.map((item) => item.contentDigest)).toContain("digest-v2");
    expect(history.rolledBack.revision).toBe(3);
    expect(history.rolledBack.contentDigest).toBe("digest-v1");

    const evidence = await withTenantTransaction(pool, seeded.tenantId, async (transaction) => ({
      audit: await new AuditRepository(transaction).list(),
      pending: await new OutboxRepository(transaction).listPending(20),
      similar: await new MemoryRepository(transaction).findSimilar({
        namespaceId: seeded.namespaceId, memoryClass: "policy", embedding: vector(0.1), limit: 5,
      }),
    }));
    expect(evidence.audit.map((event) => event.action)).toEqual(
      expect.arrayContaining(["memory.promoted", "memory.superseded", "memory.rolled_back"]),
    );
    expect(evidence.pending.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(["memory.promoted", "memory.rolled_back"]),
    );
    expect(evidence.similar).toHaveLength(1);
    expect(evidence.similar[0]?.memory.id).toBe(history.rolledBack.id);
  });

  it("rejects stale reviews after the namespace baseline changes", async () => {
    const seeded = await seed(`stale-${randomUUID()}`);
    const candidate = await createCandidate(seeded, "digest-stale", "candidate-stale");

    await withTenantTransaction(pool, seeded.tenantId, async (transaction) => {
      const candidates = new CandidateRepository(transaction);
      const evaluations = new EvaluationRepository(transaction);
      const reviews = new ReviewRepository(transaction);
      await candidates.transition(candidate.id, "screening");
      await candidates.transition(candidate.id, "evaluating");
      const run = await evaluations.createRun({
        id: randomUUID(), candidateId: candidate.id, baselineRevision: 0, policyVersion: "policy-v1",
      });
      await evaluations.completeRun(run.id, "passed", {});
      await candidates.transition(candidate.id, "review_required");
      const review = await reviews.decide({
        id: randomUUID(), candidateId: candidate.id, reviewerId: seeded.principalId,
        decision: "approved", candidateDigest: candidate.contentDigest, evaluationRunId: run.id,
        baselineRevision: 0, policyVersion: "policy-v1", reason: "Looks good",
      });
      await transaction.client.query(
        "UPDATE agent_namespaces SET current_revision = 1 WHERE tenant_id = $1 AND id = $2",
        [seeded.tenantId, seeded.namespaceId],
      );
      await expect(reviews.assertFresh(candidate.id, review.id)).rejects.toThrow(/stale/i);
    });
  });

  it("returns the same revision for an idempotent promotion retry", async () => {
    const seeded = await seed(`retry-${randomUUID()}`);
    const candidate = await createCandidate(seeded, "digest-retry", "candidate-retry");
    const reviewId = randomUUID();

    await withTenantTransaction(pool, seeded.tenantId, async (transaction) => {
      const candidates = new CandidateRepository(transaction);
      const evaluations = new EvaluationRepository(transaction);
      const reviews = new ReviewRepository(transaction);
      await candidates.transition(candidate.id, "screening");
      await candidates.transition(candidate.id, "evaluating");
      const run = await evaluations.createRun({
        id: randomUUID(), candidateId: candidate.id, baselineRevision: 0, policyVersion: "policy-v1",
      });
      await evaluations.completeRun(run.id, "passed", {});
      await candidates.transition(candidate.id, "review_required");
      await reviews.decide({
        id: reviewId, candidateId: candidate.id, reviewerId: seeded.principalId,
        decision: "approved", candidateDigest: candidate.contentDigest, evaluationRunId: run.id,
        baselineRevision: 0, policyVersion: "policy-v1", reason: "Approve retry test",
      });
      await candidates.transition(candidate.id, "approved");
    });

    const promote = () => withTenantTransaction(pool, seeded.tenantId, (transaction) =>
      new MemoryRepository(transaction).promote({
        candidateId: candidate.id, reviewId, actorId: seeded.principalId,
        stableKey: "retry-policy", reason: "Activate once", idempotencyKey: "same-promotion-request",
      }),
    );
    const [first, repeated] = await Promise.all([promote(), promote()]);

    expect(repeated.id).toBe(first.id);
    expect(repeated.revision).toBe(1);
    const versions = await withTenantTransaction(pool, seeded.tenantId, async ({ client }) =>
      client.query("SELECT id FROM memory_versions WHERE tenant_id=$1 AND namespace_id=$2", [seeded.tenantId, seeded.namespaceId]),
    );
    expect(versions.rowCount).toBe(1);
  });

  it("replays the exact lifecycle receipt and rejects a reused key with another request", async () => {
    const seeded = await seed(`receipt-${randomUUID()}`);
    const resourceId = randomUUID(); let calls = 0;
    const invoke = (request: unknown) => withTenantTransaction(pool, seeded.tenantId, (transaction) =>
      new LifecycleReceiptRepository(transaction).replay({ operation: "candidate.screen", resourceId, idempotencyKey: "same-key", request, execute: async () => ({ candidateId: resourceId, state: `state-${++calls}` }) }),
    );
    const first = await invoke({ decision: "screen" });
    const replayed = await invoke({ decision: "screen" });
    expect(replayed).toEqual(first); expect(calls).toBe(1);
    await expect(invoke({ decision: "different" })).rejects.toMatchObject({ code: "conflict" });
  });
});
