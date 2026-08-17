ALTER TABLE workspace_bootstraps
  ALTER PRIMARY KEY USING COLUMNS (tenant_id, idempotency_key);
