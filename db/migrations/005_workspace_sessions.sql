CREATE TABLE IF NOT EXISTS workspace_bootstraps (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  idempotency_key STRING NOT NULL,
  principal_id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  agent_id UUID NOT NULL,
  workspace_name STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES principals (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES principals (tenant_id, id)
);

GRANT SELECT, INSERT ON TABLE workspace_bootstraps TO memory_ci_app;
REVOKE UPDATE, DELETE ON TABLE workspace_bootstraps FROM memory_ci_app;
GRANT SELECT ON TABLE workspace_bootstraps TO memory_ci_auditor;
