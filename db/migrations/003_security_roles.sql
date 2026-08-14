CREATE ROLE IF NOT EXISTS memory_ci_auditor;

GRANT USAGE ON SCHEMA public TO memory_ci_app, memory_ci_auditor;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO memory_ci_auditor;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO memory_ci_auditor;

REVOKE CREATE ON SCHEMA public FROM public;

REVOKE UPDATE, DELETE ON TABLE
  audit_events, activation_events, reviews, screening_findings, memory_reads
FROM memory_ci_app;
