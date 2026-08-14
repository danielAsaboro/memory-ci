# CockroachDB Agent Skills review

Reviewed against `cockroachlabs/cockroachdb-skills` at the repository revision cloned for the submission evidence pass.

## Skills applied

- `cockroachdb-sql`
- `designing-application-transactions`
- `hardening-user-privileges`
- `configuring-audit-logging`
- `reviewing-cluster-health`

## Findings and actions

| Area | Finding | Action |
| --- | --- | --- |
| Keys and distribution | Every application table has an explicit UUID or tenant-prefixed primary key. No sequential primary-key hotspot exists. | Retained. |
| Vector search | Operational rows and 1024-dimension embeddings share one transactional store. Vector indexes prefix tenant, namespace, and memory class, matching exact query constraints. The local one-row plan initially recommended a covering exact-filter index. | Added executable `vector-evidence.ts`; it runs `EXPLAIN` before the query as required by the SQL skill. Added the partial covering `memory_versions_active_lookup_idx`, and reran EXPLAIN to verify an index-only tenant/namespace/class span. |
| Transaction retries | Only SQL runs inside tenant transactions, but retries were immediate and capped at three attempts. | Added five-attempt bounded exponential backoff with jitter for SQLSTATE `40001`; `40003` ambiguous commits remain fail-closed. |
| External side effects | Bedrock, S3, EventBridge, and sandbox tool calls must not execute in retried transactions. | Retained the transactional outbox and content-addressed idempotency boundaries. |
| Privileges | The app role could mutate append-only release evidence, and `PUBLIC` could create objects in the application schema. | Added migration `003_security_roles.sql`: read-only auditor role, default read grants, removal of public schema creation, and update/delete revocations on audit, activation, review, screening, and read-receipt tables. |
| Audit logging | Memory CI has a digest-chained application audit table, but local CockroachDB cluster SQL audit settings are disabled by default. | Keep local state explicit. For Cloud, enable targeted role/admin audit logging and verify log export before claiming production proof. |
| Health | Local CockroachDB v26.2.3 is connected and migrations/vector tests pass. A one-node insecure Docker cluster is development evidence, not production availability evidence. | Cloud tier, regions, state, backups, and alerts remain gated on `ccloud` authentication. |

## Verification gates

- `npm run test:integration -- src/db/migrations.integration.test.ts`
- `npm run demo:seed`
- `npm run vector:evidence`
- `npm run ccloud:evidence`
- `SHOW CLUSTER SETTING sql.log.user_audit`
- `SHOW CLUSTER SETTING sql.log.admin_audit.enabled`

The public repository intentionally contains procedures and sanitized outputs only. Authenticated provider receipts belong in the private parent submission evidence directory.
