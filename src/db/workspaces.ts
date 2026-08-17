import type { TenantTransaction } from "./client";

export type WorkspaceBootstrap = Readonly<{
  tenantId: string;
  principalId: string;
  workspaceName: string;
  namespaceId: string;
  agentId: string;
  roles: ["admin", "reviewer"];
}>;

type WorkspaceBootstrapRow = {
  tenant_id: string;
  principal_id: string;
  namespace_id: string;
  agent_id: string;
  workspace_name: string;
};

const mapWorkspaceBootstrap = (row: WorkspaceBootstrapRow): WorkspaceBootstrap => ({
  tenantId: row.tenant_id,
  principalId: row.principal_id,
  namespaceId: row.namespace_id,
  agentId: row.agent_id,
  workspaceName: row.workspace_name,
  roles: ["admin", "reviewer"],
});

export class WorkspaceRepository {
  constructor(private readonly transaction: TenantTransaction) {}

  async getByIdempotencyKey(idempotencyKey: string): Promise<WorkspaceBootstrap | null> {
    const result = await this.transaction.client.query<WorkspaceBootstrapRow>(
      `SELECT tenant_id,principal_id,namespace_id,agent_id,workspace_name
       FROM workspace_bootstraps WHERE idempotency_key=$1`,
      [idempotencyKey],
    );
    return result.rows[0] ? mapWorkspaceBootstrap(result.rows[0]) : null;
  }

  async create(input: WorkspaceBootstrap & { idempotencyKey: string }): Promise<WorkspaceBootstrap> {
    const result = await this.transaction.client.query<WorkspaceBootstrapRow>(
      `INSERT INTO workspace_bootstraps
       (idempotency_key,tenant_id,principal_id,namespace_id,agent_id,workspace_name)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING tenant_id,principal_id,namespace_id,agent_id,workspace_name`,
      [input.idempotencyKey, input.tenantId, input.principalId, input.namespaceId, input.agentId, input.workspaceName],
    );
    return mapWorkspaceBootstrap(result.rows[0]!);
  }
}
