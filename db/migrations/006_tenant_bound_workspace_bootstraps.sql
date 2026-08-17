ALTER TABLE workspace_bootstraps
  ALTER PRIMARY KEY USING COLUMNS (tenant_id, idempotency_key);

DROP INDEX workspace_bootstraps@workspace_bootstraps_idempotency_key_key;
