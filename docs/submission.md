# Stash hackathon submission

## One-line pitch

Stash is the release control plane for production agent memory: provenance, poisoning checks, behavioral tests, evidence-bound review, atomic promotion, semantic retrieval, lineage, and forward-only rollback.

## What it does

Agent memory is production state. A poisoned instruction can silently change every future action by every agent that retrieves it. Stash puts a release protocol between proposed memory and active truth.

Every proposal has immutable provenance and a content digest. Deterministic screening blocks injection, scope broadening, secrets, and unsupported trust claims. Safe candidates are replayed against recorded scenarios at both the baseline and candidate-overlay revisions. Tool constraints are deterministic; Amazon Bedrock is restricted to a structured judgment contract, and timeout or malformed output is inconclusive.

Approval binds exact content, evaluation, policy, and baseline. A CockroachDB serializable transaction rejects stale evidence, supersedes the prior version, activates the new version, advances namespace revision, appends tamper-evident audit lineage, and writes the outbox event. Retrieval searches only active memory through the co-resident distributed vector index. Rollback creates another auditable forward revision.

## Why CockroachDB is essential

CockroachDB is the consistency boundary for candidates, provenance, evaluations, reviews, active revisions, retrieval receipts, audit lineage, and outbox delivery. `VECTOR(1024)` embeddings and distributed vector indexes live beside transactional state, eliminating drift between semantic search and the authoritative release record.

## Tools used

- **CockroachDB Distributed Vector Indexing:** tenant/namespace/active-prefixed 1024-dimensional cosine index for production agent retrieval. Live evidence checks the column, exact index definition, succeeded index job, and indexed query plan.
- **ccloud CLI:** authenticated JSON evidence verifies the live AWS-hosted CockroachDB Cloud cluster, organization, region, tier, host, and created state.
- **CockroachDB Agent Skills Repo:** official schema, transaction, privilege, audit, and operational-health skills informed implementation review.
- **Amazon Bedrock:** structured semantic-risk evaluation plus managed 1024-dimensional embeddings.
- **AWS Lambda and API Gateway:** authenticated API, transactional outbox, and behavioral sandbox.
- **Amazon S3:** encrypted, versioned, content-addressed evaluation artifacts.
- **Amazon EventBridge:** idempotent lifecycle distribution; Secrets Manager, CloudWatch, X-Ray, and Cognito support production operation.

## What makes it different

Most memory products optimize what an agent *can* remember. Stash governs what an agent is *allowed* to remember. Memory changes ship like code: reviewable, behavior-tested, atomic, observable, reversible, and durable across failures.

| Requirement | Public proof |
|---|---|
| Functional production app | [trystash.xyz](https://trystash.xyz) |
| Public open-source repository | [github.com/danielAsaboro/stash-cockcroachdb](https://github.com/danielAsaboro/stash-cockcroachdb) |
| Persistent CockroachDB memory | `db/migrations/`, integration tests, and live redacted receipt |
| Two or more CockroachDB tools | Distributed Vector Indexing, `ccloud` CLI, and Agent Skills Repo |
| AWS deployment | SAM stack plus correlated Bedrock/Lambda/S3/EventBridge/CloudWatch/X-Ray receipt |
| Reproducible quality | unit, Cockroach integration, desktop/mobile lifecycle, WCAG, SAM, and production audit gates |
| Under-three-minute video | 2:41.83 rendered demo; public YouTube/Vimeo link added at submission time |

## Production evidence

[evidence/stash-production.json](evidence/stash-production.json) is generated—not hand-authored—only after strict cross-receipt validation. Account and credential material are structurally redacted. It records one correlated live run across AWS and CockroachDB Cloud; the collector refuses fixtures, stale receipts, mismatched identities, incomplete vector jobs, missing provider request IDs, or unobserved artifacts.

## CockroachDB AI tool feedback

- A first-party command that exports vector-index definition, job readiness, and `EXPLAIN` evidence together would simplify production audits.
- Versioned Agent Skills manifests and machine-readable result schemas would make applied guidance easier to attest.
- Managed MCP's read-only default and audit trail are strong safety choices; a contract-compatible local simulator would improve pre-cloud development.
- `ccloud` JSON output is agent-friendly. A documented non-interactive device flow for short-lived hackathon service accounts would reduce the remaining manual authentication boundary.
