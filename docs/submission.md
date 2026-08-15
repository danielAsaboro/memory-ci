# Hackathon submission evidence matrix

## Devpost copy

### One-line pitch

Memory CI is the release control plane for production agent memory: pull requests, behavioral tests, evidence-bound review, atomic promotion, lineage, and forward-only rollback.

### What it does

Agent memory is production state. A poisoned instruction does not affect one answer; once activated, it can silently change every future action by every agent that retrieves it. Memory CI puts a release protocol between candidate memory and active memory.

Every proposed change arrives with provenance and an immutable digest. Deterministic screening blocks prompt injection, scope broadening, secret-like content, and unsupported provenance. Safe candidates are evaluated by replaying matched scenarios against both the current revision and the candidate overlay. Tool constraints are checked deterministically; Amazon Bedrock is restricted to a forced structured judgment contract, and a timeout or malformed response is inconclusive rather than a pass.

Approval binds the candidate digest, evaluation run, policy version, and baseline revision. A single CockroachDB serializable transaction rejects stale evidence, supersedes the previous version, activates the new one, increments the namespace revision, appends the tamper-evident audit chain, and writes the transactional outbox event. Retrieval reads only active versions, records purpose and exact revision, and supports forward-only rollback without deleting history.

### Why CockroachDB is essential

CockroachDB is not a passive transcript store. It is the consistency boundary for candidate state, active revisions, evaluation evidence, approvals, retrieval receipts, audit lineage, and outbox delivery. `VECTOR(1024)` embeddings and distributed vector indexes live beside that operational state, eliminating drift between semantic retrieval and the authoritative release record.

### How it was built

- Next.js and TypeScript provide the responsive reviewer console and deterministic judge demo.
- CockroachDB stores the full memory release graph with tenant-scoped constraints, serializable promotion, retry handling, vector indexes, immutable audit linkage, and an idempotent outbox.
- Amazon Bedrock supplies structured semantic-risk and behavioral-diff judgments.
- AWS Lambda runs the API adapter, deterministic tool sandbox, and outbox dispatcher.
- Amazon S3 stores encrypted, versioned, content-addressed evidence artifacts.
- Amazon EventBridge distributes idempotent lifecycle events; Cognito, Secrets Manager, CloudWatch, and X-Ray provide identity, secret delivery, alarms, logs, and traces.
- AWS SAM defines the deployable cloud environment and its least-privilege policies.

### What makes it different

Most memory products optimize what an agent can remember. Memory CI governs what an agent is allowed to remember. It treats memory changes as releases, evaluates downstream behavior rather than prose similarity, fails closed when evidence is incomplete, and makes rollback a new auditable revision rather than destructive history rewriting.

### CockroachDB AI tool feedback

- Distributed Vector Indexing is most valuable when vector and transactional state can be proven co-resident and consistent; an official one-command evidence export for index metadata plus `EXPLAIN` would make demos and audits easier.
- The Agent Skills Repo usefully turns production guidance into executable review steps. Versioned skill manifests and machine-readable result schemas would make it easier to record exactly which guidance informed a release.
- Managed MCP's read-only default and audit trail are strong safety choices. A local authenticated simulator would help teams develop and test the same MCP contract before a cloud cluster is available.
- `ccloud` JSON output is agent-friendly. A documented non-interactive device flow and short-lived hackathon service-account bootstrap would reduce the remaining manual setup boundary.

| Requirement | Implementation | Reproducible proof |
|---|---|---|
| Agentic application | Memory release control plane with ingestion, screening, behavioral evaluation, approval, promotion, retrieval, explanation, and rollback | `npm test`, `npm run test:integration`, `npm run test:e2e` |
| Persistent memory | CockroachDB candidates, versions, namespace revisions, provenance, evaluations, reviews, reads, audit, and outbox | `db/migrations/001_initial.sql` and integration tests |
| Distributed Vector Indexing | `VECTOR(1024)` columns and tenant/namespace/class-prefixed vector indexes | `npm run vector:evidence` prints version, index metadata, `EXPLAIN`, and a neighbor query |
| Agent Skills Repo | Official SQL, transaction, privilege, audit, and health skills applied to schema and evidence review | `scripts/agent-skill-review.md` |
| Amazon Bedrock | Forced-tool semantic risk and behavioral-diff judging with provider request IDs | unit tests; authenticated proof via `npm run aws:smoke` |
| AWS Lambda | Real API Gateway adapter, outbox dispatcher, and refund sandbox | SAM build plus unit tests |
| Amazon S3 | Content-addressed evaluation artifacts, versioned encrypted bucket | artifact unit tests and SAM template |
| EventBridge | Transactional outbox delivery with stable event IDs and retry | event tests and `src/lambda/outbox.ts` |
| Public open source | MIT license, complete source, setup and test instructions | `https://github.com/danielAsaboro/memory-ci` |
| Functional demo | Responsive deterministic judge experience | `https://memory-ci.asaborodaniel.chatgpt.site` |
| Under-3-minute video | Rendered 2:41.83 master with narration, captions, and CockroachDB memory proof | public YouTube/Vimeo URL requires final upload |

## Honest cloud-proof status

Local tests, CockroachDB vector queries, SAM validation, and SAM build are reproducible now. AWS account calls, CockroachDB Cloud Managed MCP, and `ccloud` require owner authentication. Scripts fail closed and should be captured only after authentication; they are not claimed as completed merely because configuration exists.
