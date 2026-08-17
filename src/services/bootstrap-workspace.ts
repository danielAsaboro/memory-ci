import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { AuditRepository } from "../db/audit";
import { withTenantTransaction } from "../db/client";
import { WorkspaceRepository, type WorkspaceBootstrap } from "../db/workspaces";

const northstarRefundPolicy = "Signed Northstar refund policy: refunds above $150 require human review and return to the original payment method.";
const northstarPayload = { refundReviewThreshold: 150, destination: "original" };
const northstarEmbedding = `[${Array.from({ length: 1024 }, () => "0.01").join(",")}]`;
const bootstrapUuidNamespace = "stash-workspace-bootstrap-v1";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function bootstrapId(idempotencyKey: string, resource: string): string {
  const bytes = createHash("sha256").update(`${bootstrapUuidNamespace}:${resource}:${idempotencyKey}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function bootstrapWorkspace(
  pool: Pool,
  input: Readonly<{ idempotencyKey: string; displayName: string }>,
): Promise<WorkspaceBootstrap> {
  const workspaceName = input.displayName.trim();
  if (!input.idempotencyKey || !workspaceName) throw new Error("idempotencyKey and displayName are required");

  const tenantId = bootstrapId(input.idempotencyKey, "tenant");
  return withTenantTransaction(pool, tenantId, async (transaction) => {
    const workspaces = new WorkspaceRepository(transaction);
    const existing = await workspaces.getByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    const principalId = bootstrapId(input.idempotencyKey, "principal");
    const namespaceId = bootstrapId(input.idempotencyKey, "namespace");
    const agentId = bootstrapId(input.idempotencyKey, "agent");
    const sourceId = bootstrapId(input.idempotencyKey, "source");
    const lineageId = bootstrapId(input.idempotencyKey, "lineage");
    const candidateId = bootstrapId(input.idempotencyKey, "candidate");
    const memoryVersionId = bootstrapId(input.idempotencyKey, "memory-version");
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
}

export type { WorkspaceBootstrap };
