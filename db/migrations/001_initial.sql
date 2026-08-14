CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY,
  slug STRING NOT NULL UNIQUE,
  name STRING NOT NULL,
  policy_config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS principals (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  kind STRING NOT NULL CHECK (kind IN ('human', 'agent', 'provider')),
  display_name STRING NOT NULL,
  external_subject STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, external_subject)
);

CREATE TABLE IF NOT EXISTS agent_namespaces (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  slug STRING NOT NULL,
  name STRING NOT NULL,
  protected BOOL NOT NULL DEFAULT false,
  current_revision INT8 NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS sources (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  source_type STRING NOT NULL CHECK (source_type IN ('message', 'document', 'tool', 'api', 'operator', 'system')),
  source_uri STRING NULL,
  trust_class STRING NOT NULL CHECK (trust_class IN ('untrusted', 'observed', 'authenticated', 'authoritative')),
  content_digest STRING NOT NULL,
  signature_identity STRING NULL,
  signature_verified BOOL NOT NULL DEFAULT false,
  valid_until TIMESTAMPTZ NULL,
  submitted_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by) REFERENCES principals (tenant_id, id),
  UNIQUE (tenant_id, content_digest, source_type)
);

CREATE TABLE IF NOT EXISTS source_artifacts (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  source_id UUID NOT NULL,
  storage_uri STRING NOT NULL,
  content_digest STRING NOT NULL,
  media_type STRING NOT NULL,
  redaction_status STRING NOT NULL CHECK (redaction_status IN ('not_required', 'redacted', 'rejected')),
  provider_version_id STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
  UNIQUE (tenant_id, content_digest)
);

CREATE TABLE IF NOT EXISTS memory_lineages (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  stable_key STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  UNIQUE (tenant_id, namespace_id, stable_key)
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  lineage_id UUID NULL,
  state STRING NOT NULL CHECK (state IN (
    'proposed', 'screening', 'evaluating', 'review_required', 'approved', 'active',
    'quarantined', 'rejected', 'superseded', 'rolled_back', 'expired', 'failed'
  )),
  memory_class STRING NOT NULL CHECK (memory_class IN ('policy', 'fact', 'preference', 'episode', 'skill', 'constraint')),
  trust_class STRING NOT NULL CHECK (trust_class IN ('untrusted', 'observed', 'authenticated', 'authoritative')),
  canonical_payload JSONB NOT NULL,
  canonical_text STRING NOT NULL DEFAULT '',
  content_digest STRING NOT NULL,
  source_id UUID NOT NULL,
  created_by UUID NOT NULL,
  embedding VECTOR(1024) NULL,
  idempotency_key STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  FOREIGN KEY (tenant_id, lineage_id) REFERENCES memory_lineages (tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES sources (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES principals (tenant_id, id),
  UNIQUE (tenant_id, namespace_id, content_digest),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS memory_versions (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  lineage_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  version INT8 NOT NULL CHECK (version > 0),
  revision INT8 NOT NULL CHECK (revision > 0),
  active BOOL NOT NULL DEFAULT false,
  memory_class STRING NOT NULL CHECK (memory_class IN ('policy', 'fact', 'preference', 'episode', 'skill', 'constraint')),
  canonical_payload JSONB NOT NULL,
  canonical_text STRING NOT NULL DEFAULT '',
  content_digest STRING NOT NULL,
  embedding VECTOR(1024) NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  FOREIGN KEY (tenant_id, lineage_id) REFERENCES memory_lineages (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES memory_candidates (tenant_id, id),
  UNIQUE (tenant_id, lineage_id, version),
  UNIQUE (tenant_id, namespace_id, revision, lineage_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_versions_one_active_idx
  ON memory_versions (tenant_id, lineage_id)
  WHERE active;

CREATE TABLE IF NOT EXISTS memory_relations (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  from_candidate_id UUID NOT NULL,
  to_memory_version_id UUID NOT NULL,
  relation_type STRING NOT NULL CHECK (relation_type IN ('contradicts', 'corroborates', 'depends_on', 'refines', 'supersedes')),
  confidence DECIMAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, from_candidate_id) REFERENCES memory_candidates (tenant_id, id),
  FOREIGN KEY (tenant_id, to_memory_version_id) REFERENCES memory_versions (tenant_id, id),
  UNIQUE (tenant_id, from_candidate_id, to_memory_version_id, relation_type)
);

CREATE TABLE IF NOT EXISTS screening_findings (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  rule_id STRING NOT NULL,
  rule_version STRING NOT NULL,
  severity STRING NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message STRING NOT NULL,
  safe_evidence JSONB NULL,
  provider_request_id STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES memory_candidates (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS evaluation_scenarios (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  name STRING NOT NULL,
  input_payload JSONB NOT NULL,
  assertions JSONB NOT NULL,
  expected_tool_constraints JSONB NOT NULL DEFAULT '{}'::JSONB,
  embedding VECTOR(1024) NOT NULL,
  active BOOL NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  UNIQUE (tenant_id, namespace_id, name)
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  baseline_revision INT8 NOT NULL CHECK (baseline_revision >= 0),
  policy_version STRING NOT NULL,
  status STRING NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'regressed', 'inconclusive', 'failed')),
  model_id STRING NULL,
  provider_request_id STRING NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES memory_candidates (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS evaluation_results (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  evaluation_run_id UUID NOT NULL,
  scenario_id UUID NOT NULL,
  status STRING NOT NULL CHECK (status IN ('passed', 'regressed', 'inconclusive', 'failed')),
  baseline_trajectory JSONB NOT NULL,
  candidate_trajectory JSONB NOT NULL,
  behavioral_diff JSONB NOT NULL,
  deterministic_assertions JSONB NOT NULL,
  semantic_judgment JSONB NULL,
  artifact_uri STRING NULL,
  provider_request_id STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_run_id) REFERENCES evaluation_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES evaluation_scenarios (tenant_id, id),
  UNIQUE (tenant_id, evaluation_run_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  reviewer_id UUID NOT NULL,
  decision STRING NOT NULL CHECK (decision IN ('approved', 'rejected', 'quarantined')),
  candidate_digest STRING NOT NULL,
  evaluation_run_id UUID NOT NULL,
  baseline_revision INT8 NOT NULL CHECK (baseline_revision >= 0),
  policy_version STRING NOT NULL,
  reason STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, candidate_id) REFERENCES memory_candidates (tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_id) REFERENCES principals (tenant_id, id),
  FOREIGN KEY (tenant_id, evaluation_run_id) REFERENCES evaluation_runs (tenant_id, id),
  UNIQUE (tenant_id, candidate_id, reviewer_id, candidate_digest, evaluation_run_id)
);

CREATE TABLE IF NOT EXISTS activation_events (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  lineage_id UUID NOT NULL,
  memory_version_id UUID NOT NULL,
  event_type STRING NOT NULL CHECK (event_type IN ('promoted', 'superseded', 'rolled_back', 'expired')),
  revision INT8 NOT NULL CHECK (revision > 0),
  actor_id UUID NOT NULL,
  reason STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  FOREIGN KEY (tenant_id, lineage_id) REFERENCES memory_lineages (tenant_id, id),
  FOREIGN KEY (tenant_id, memory_version_id) REFERENCES memory_versions (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES principals (tenant_id, id),
  UNIQUE (tenant_id, namespace_id, revision, lineage_id, event_type)
);

CREATE TABLE IF NOT EXISTS memory_reads (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  namespace_id UUID NOT NULL,
  principal_id UUID NOT NULL,
  revision INT8 NOT NULL CHECK (revision >= 0),
  query_digest STRING NOT NULL,
  returned_version_ids UUID[] NOT NULL,
  purpose STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, namespace_id) REFERENCES agent_namespaces (tenant_id, id),
  FOREIGN KEY (tenant_id, principal_id) REFERENCES principals (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  event_type STRING NOT NULL,
  aggregate_type STRING NOT NULL,
  aggregate_id UUID NOT NULL,
  payload JSONB NOT NULL,
  attempts INT8 NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ NULL,
  provider_event_id STRING NULL,
  last_error_code STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS outbox_delivery_idx
  ON outbox_events (delivered_at, available_at)
  WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_events (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action STRING NOT NULL,
  resource_type STRING NOT NULL,
  resource_id UUID NOT NULL,
  request_id STRING NOT NULL,
  trace_id STRING NULL,
  provider_request_id STRING NULL,
  safe_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  previous_event_digest STRING NULL,
  event_digest STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES principals (tenant_id, id),
  UNIQUE (tenant_id, event_digest)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id UUID NOT NULL REFERENCES tenants (id),
  idempotency_key STRING NOT NULL,
  operation STRING NOT NULL,
  request_digest STRING NOT NULL,
  response_status INT4 NOT NULL,
  response_body JSONB NOT NULL,
  resource_id UUID NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE ROLE IF NOT EXISTS memory_ci_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  tenants, principals, agent_namespaces, sources, source_artifacts,
  memory_lineages, memory_candidates, memory_versions, memory_relations,
  screening_findings, evaluation_scenarios, evaluation_runs, evaluation_results,
  reviews, activation_events, memory_reads, outbox_events, idempotency_keys
TO memory_ci_app;

GRANT SELECT, INSERT ON TABLE audit_events TO memory_ci_app;
REVOKE UPDATE, DELETE ON TABLE audit_events FROM memory_ci_app;
