CREATE TABLE lifecycle_mutation_receipts (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  operation STRING NOT NULL,
  resource_id UUID NOT NULL,
  idempotency_key STRING NOT NULL,
  request_digest STRING NOT NULL,
  receipt JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, operation, resource_id, idempotency_key)
);

GRANT SELECT, INSERT ON lifecycle_mutation_receipts TO memory_ci_app;
REVOKE UPDATE, DELETE ON lifecycle_mutation_receipts FROM memory_ci_app;
GRANT SELECT ON lifecycle_mutation_receipts TO memory_ci_auditor;
