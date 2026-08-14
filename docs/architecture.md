# Architecture and release protocol

## Invariant

Only an active `memory_versions` row at a committed namespace revision is visible to an agent. Candidates, evaluation output, and approvals never leak into retrieval.

## Release sequence

1. Ingestion canonicalizes and redacts content, verifies the source digest, records provenance, and creates a proposed candidate.
2. Deterministic screening checks instruction injection, scope broadening, protected-memory mutation, secret material, signature claims, attribution, replay, and expiry.
3. Evaluation replays matched scenarios against the baseline revision and candidate overlay. Deterministic tool assertions run before Bedrock judges behavioral changes. Evidence is content-addressed in S3.
4. A reviewer decision binds candidate digest, evaluation run, policy version, and baseline revision.
5. One serializable transaction locks the namespace and lineage, rejects stale approval, supersedes the old active version, creates the new version, increments the namespace revision, appends audit and activation events, and enqueues an outbox event.
6. Rollback creates a new forward revision from a prior version; history is never rewritten.

## Trust boundaries

- Cognito validates identity at API Gateway; the Lambda maps `sub` to a tenant-local principal and all repository access includes `tenant_id`.
- Candidate text and provider output are untrusted data. Provider output must match a forced-tool Zod contract.
- Secrets Manager supplies the CockroachDB URL. S3 is encrypted, versioned, private, and retained.
- Audit events form a tenant-serialized SHA-256 digest chain and the application role cannot update or delete them.
- EventBridge delivery is at-least-once; stable outbox IDs support idempotent consumers.

## Failure behavior

Missing scenarios, provider timeout, malformed Bedrock output, stale review, missing embedding, or conflicting idempotency keys fail closed. CockroachDB serialization failures retry with bounded exponential backoff and jitter; ambiguous commit errors are not blindly retried.
