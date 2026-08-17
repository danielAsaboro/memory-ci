import { randomUUID } from "node:crypto";

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
