import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { AuditRepository } from "../db/audit";
import { withTenantTransaction } from "../db/client";
import { WorkspaceRepository, type WorkspaceBootstrap } from "../db/workspaces";

const northstarRefundPolicy = "Signed Northstar refund policy: refunds above $150 require human review and return to the original payment method.";
const northstarPayload = { refundReviewThreshold: 150, destination: "original" };
const northstarEmbedding = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null &&
  "code" in error && String(error.code) === "23505";

export async function bootstrapWorkspace(
  pool: Pool,
  input: Readonly<{ idempotencyKey: string; displayName: string }>,
): Promise<WorkspaceBootstrap> {
  const workspaceName = input.displayName.trim();
  if (!input.idempotencyKey || !workspaceName) throw new Error("idempotencyKey and displayName are required");

  const tenantId = randomUUID();
  try {
    return await withTenantTransaction(pool, tenantId, async (transaction) => {
      const workspaces = new WorkspaceRepository(transaction);
      const existing = await workspaces.getByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;

      const principalId = randomUUID();
      const namespaceId = randomUUID();
      const agentId = randomUUID();
      const sourceId = randomUUID();
      const lineageId = randomUUID();
      const candidateId = randomUUID();
      const memoryVersionId = randomUUID();
      const sourceDigest = digest(northstarRefundPolicy);
      const policyDigest = digest(JSON.stringify(northstarPayload));

      await transaction.client.query(
        "INSERT INTO tenants (id,slug,name,policy_config) VALUES ($1,$2,$3,$4)",
        [tenantId, `workspace-${tenantId}`, workspaceName, { starterPolicy: "northstar-refund-v1" }],
      );
      await transaction.client.query(
        `INSERT INTO principals (tenant_id,id,kind,display_name) VALUES
         ($1,$2,'human',$3),($1,$4,'agent','Northstar Refund Agent')`,
        [tenantId, principalId, workspaceName, agentId],
      );
      await transaction.client.query(
        `INSERT INTO agent_namespaces (tenant_id,id,slug,name,protected,current_revision)
         VALUES ($1,$2,'refunds','Refund policy',true,0)`,
        [tenantId, namespaceId],
      );
      await transaction.client.query(
        `INSERT INTO sources
         (tenant_id,id,source_type,source_uri,trust_class,content_digest,signature_identity,signature_verified,submitted_by)
         VALUES ($1,$2,'document','https://northstar.example/policies/refunds','authoritative',$3,'northstar-refund-policy',true,$4)`,
        [tenantId, sourceId, sourceDigest, principalId],
      );
      await transaction.client.query(
        "INSERT INTO memory_lineages (tenant_id,id,namespace_id,stable_key) VALUES ($1,$2,$3,'refund-review-threshold')",
        [tenantId, lineageId, namespaceId],
      );
      await transaction.client.query(
        `INSERT INTO memory_candidates
         (tenant_id,id,namespace_id,lineage_id,state,memory_class,trust_class,canonical_payload,canonical_text,
          content_digest,source_id,created_by,embedding)
         VALUES ($1,$2,$3,$4,'active','policy','authoritative',$5,$6,$7,$8,$9,$10::VECTOR)`,
        [tenantId, candidateId, namespaceId, lineageId, northstarPayload, northstarRefundPolicy,
          policyDigest, sourceId, principalId, northstarEmbedding],
      );
      await transaction.client.query(
        `INSERT INTO memory_versions
         (tenant_id,id,namespace_id,lineage_id,candidate_id,version,revision,active,memory_class,canonical_payload,
          canonical_text,content_digest,embedding)
         VALUES ($1,$2,$3,$4,$5,1,1,true,'policy',$6,$7,$8,$9::VECTOR)`,
        [tenantId, memoryVersionId, namespaceId, lineageId, candidateId, northstarPayload,
          northstarRefundPolicy, policyDigest, northstarEmbedding],
      );
      await transaction.client.query(
        "UPDATE agent_namespaces SET current_revision=1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [tenantId, namespaceId],
      );

      const workspace = await workspaces.create({
        tenantId, principalId, namespaceId, agentId, workspaceName,
        roles: ["admin", "reviewer"], idempotencyKey: input.idempotencyKey,
      });
      await new AuditRepository(transaction).append({
        actorId: principalId,
        action: "workspace.created",
        resourceType: "workspace",
        resourceId: tenantId,
        requestId: input.idempotencyKey,
        safeDetails: { namespaceId, agentId, starterMemoryVersionId: memoryVersionId },
      });
      return workspace;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return withTenantTransaction(pool, randomUUID(), async (transaction) => {
      const existing = await new WorkspaceRepository(transaction).getByIdempotencyKey(input.idempotencyKey);
      if (!existing) throw error;
      return existing;
    });
  }
}

export type { WorkspaceBootstrap };
