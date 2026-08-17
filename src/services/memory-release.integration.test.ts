import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPool, withTenantTransaction } from "../db/client";
import { migrate } from "../db/migrate";
import type { TenantContext } from "../domain/types";
import { explainMemory } from "./explain-memory";
import { promoteCandidate } from "./promote-candidate";
import { retrieveActiveMemory } from "./retrieve-memory";
import { decideReview } from "./review-candidate";
import { rollbackMemory } from "./rollback-memory";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL ??
  "postgresql://root@127.0.0.1:26258/defaultdb?sslmode=disable";
const databaseName = `memory_ci_release_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = (() => { const url = new URL(adminUrl); url.pathname = `/${databaseName}`; return url.toString(); })();
const embedding = `[${Array.from({ length: 1024 }, () => 0.1).join(",")}]`;

let admin: Client;
const pool = createPool(databaseUrl);
const tenantId = randomUUID();
const ownerId = randomUUID();
const agentId = randomUUID();
const namespaceId = randomUUID();
const sourceId = randomUUID();
const ownerContext: TenantContext = { tenantId, principalId: ownerId, requestId: "owner-request" };
const agentContext: TenantContext = { tenantId, principalId: agentId, requestId: "agent-request" };

async function seedReviewable(input: {
  digest: string; threshold: number; baselineRevision: number; status?: "passed" | "regressed";
}) {
  const candidateId = randomUUID();
  const runId = randomUUID();
  await withTenantTransaction(pool, tenantId, async ({ client }) => {
    await client.query(
      `INSERT INTO memory_candidates
       (tenant_id,id,namespace_id,state,memory_class,trust_class,canonical_payload,canonical_text,
        content_digest,source_id,created_by,embedding)
       VALUES ($1,$2,$3,'review_required','policy','authoritative',$4,$5,$6,$7,$8,$9::VECTOR)`,
      [tenantId, candidateId, namespaceId, { refundReviewThreshold: input.threshold },
        `Refunds above $${input.threshold} require review.`, input.digest, sourceId, ownerId, embedding],
    );
    await client.query(
      `INSERT INTO evaluation_runs
       (tenant_id,id,candidate_id,baseline_revision,policy_version,status,started_at,completed_at,model_id,provider_request_id)
       VALUES ($1,$2,$3,$4,'policy-v1',$5,now(),now(),'bedrock-test','aws-eval-request')`,
      [tenantId, runId, candidateId, input.baselineRevision, input.status ?? "passed"],
    );
  });
  return { candidateId, runId };
}

describe("memory release flow", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    await migrate(databaseUrl);
    await withTenantTransaction(pool, tenantId, async ({ client }) => {
      await client.query("INSERT INTO tenants (id,slug,name) VALUES ($1,'northstar','Northstar Support')", [tenantId]);
      await client.query(
        `INSERT INTO principals (tenant_id,id,kind,display_name) VALUES
         ($1,$2,'human','Policy owner'),($1,$3,'agent','Refund agent B')`,
        [tenantId, ownerId, agentId],
      );
      await client.query(
        "INSERT INTO agent_namespaces (tenant_id,id,slug,name,protected) VALUES ($1,$2,'refunds','Refunds',true)",
        [tenantId, namespaceId],
      );
      await client.query(
        `INSERT INTO sources
         (tenant_id,id,source_type,source_uri,trust_class,content_digest,signature_identity,signature_verified,submitted_by)
         VALUES ($1,$2,'operator','s3://northstar/policies/refunds.md','authoritative','source-digest','policy-owner',true,$3)`,
        [tenantId, sourceId, ownerId],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE ${databaseName} CASCADE`);
    await admin.end();
  });

  it("quarantines a candidate with critical screening evidence even when approval is requested", async () => {
    const poison = await seedReviewable({ digest: "poison-digest", threshold: 0, baselineRevision: 0, status: "regressed" });
    await withTenantTransaction(pool, tenantId, ({ client }) => client.query(
      `INSERT INTO screening_findings
       (tenant_id,id,candidate_id,rule_id,rule_version,severity,message,safe_evidence)
       VALUES ($1,$2,$3,'untrusted_tool_directive','1','critical','Redirected refund destination',$4)`,
      [tenantId, randomUUID(), poison.candidateId, { destination: "gift-card:[redacted]" }],
    ).then(() => undefined));

    const review = await withTenantTransaction(pool, tenantId, (transaction) => decideReview(transaction, ownerContext, {
      candidateId: poison.candidateId, evaluationRunId: poison.runId, requestedDecision: "approved",
      reason: "Attempted override", policyVersion: "policy-v1",
    }));
    expect(review.decision).toBe("quarantined");
    const state = await withTenantTransaction(pool, tenantId, ({ client }) => client.query<{ state: string }>(
      "SELECT state FROM memory_candidates WHERE tenant_id=$1 AND id=$2", [tenantId, poison.candidateId],
    ));
    expect(state.rows[0]?.state).toBe("quarantined");
  });

  it("promotes a legitimate update, serves it to a second agent, explains it, and rolls back", async () => {
    const v1 = await seedReviewable({ digest: "refund-policy-v1", threshold: 100, baselineRevision: 0 });
    const review1 = await withTenantTransaction(pool, tenantId, (transaction) => decideReview(transaction, ownerContext, {
      candidateId: v1.candidateId, evaluationRunId: v1.runId, requestedDecision: "approved",
      reason: "Verified original policy", policyVersion: "policy-v1",
    }));
    const active1 = await withTenantTransaction(pool, tenantId, (transaction) => promoteCandidate(transaction, ownerContext, {
      candidateId: v1.candidateId, reviewId: review1.id, stableKey: "refund-review-threshold",
      reason: "Initial verified release", idempotencyKey: "release-v1",
    }));

    const v2 = await seedReviewable({ digest: "refund-policy-v2", threshold: 150, baselineRevision: 1 });
    const review2 = await withTenantTransaction(pool, tenantId, (transaction) => decideReview(transaction, ownerContext, {
      candidateId: v2.candidateId, evaluationRunId: v2.runId, requestedDecision: "approved",
      reason: "Signed threshold increase passed evaluation", policyVersion: "policy-v1",
    }));
    const active2 = await withTenantTransaction(pool, tenantId, (transaction) => promoteCandidate(transaction, ownerContext, {
      candidateId: v2.candidateId, reviewId: review2.id, stableKey: "refund-review-threshold",
      reason: "Release threshold increase", idempotencyKey: "release-v2",
    }));

    const current = await withTenantTransaction(pool, tenantId, (transaction) => retrieveActiveMemory(transaction, agentContext, {
      namespaceId, query: "When does a refund require review?", purpose: "customer_support",
    }, { embed: async () => embedding }));
    const pinned = await withTenantTransaction(pool, tenantId, (transaction) => retrieveActiveMemory(transaction, agentContext, {
      namespaceId, revision: 1, query: "Prior threshold", purpose: "incident_replay",
    }, { embed: async () => embedding }));
    const explanation = await withTenantTransaction(pool, tenantId, (transaction) => explainMemory(transaction, active2.id));

    expect(current.revision).toBe(2);
    expect(current.memories[0]?.canonicalPayload).toEqual({ refundReviewThreshold: 150 });
    expect(pinned.memories[0]?.canonicalPayload).toEqual({ refundReviewThreshold: 100 });
    expect(explanation).toMatchObject({
      memoryVersionId: active2.id,
      provenance: { sourceUri: "s3://northstar/policies/refunds.md", signatureVerified: true },
      review: { decision: "approved" },
      evaluation: { status: "passed", providerRequestId: "aws-eval-request" },
    });

    const rolledBack = await withTenantTransaction(pool, tenantId, (transaction) => rollbackMemory(transaction, ownerContext, {
      lineageId: active2.lineageId, targetVersionId: active1.id, reason: "Post-release regression",
      idempotencyKey: "rollback-release-v1",
    }));
    const afterRollback = await withTenantTransaction(pool, tenantId, (transaction) => retrieveActiveMemory(transaction, agentContext, {
      namespaceId, query: "Current threshold", purpose: "customer_support",
    }, { embed: async () => embedding }));
    expect(rolledBack.revision).toBe(3);
    expect(afterRollback.memories[0]?.contentDigest).toBe("refund-policy-v1");

    const reads = await withTenantTransaction(pool, tenantId, ({ client }) => client.query(
      "SELECT principal_id,revision FROM memory_reads WHERE tenant_id=$1 ORDER BY created_at", [tenantId],
    ));
    expect(reads.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ principal_id: agentId, revision: "2" }),
      expect.objectContaining({ principal_id: agentId, revision: "1" }),
      expect.objectContaining({ principal_id: agentId, revision: "3" }),
    ]));
  });

  it("refuses promotion when no bound approval exists", async () => {
    const candidate = await seedReviewable({ digest: "missing-review", threshold: 175, baselineRevision: 3 });
    await withTenantTransaction(pool, tenantId, ({ client }) => client.query(
      "UPDATE memory_candidates SET state='approved' WHERE tenant_id=$1 AND id=$2", [tenantId, candidate.candidateId],
    ).then(() => undefined));
    await expect(withTenantTransaction(pool, tenantId, (transaction) => promoteCandidate(transaction, ownerContext, {
      candidateId: candidate.candidateId, reviewId: randomUUID(), stableKey: "refund-review-threshold",
      reason: "Should fail", idempotencyKey: "missing-review-release",
    }))).rejects.toMatchObject({ code: "not_found" });
  });
});
