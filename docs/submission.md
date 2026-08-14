# Hackathon submission evidence matrix

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
| Under-3-minute video | Script and shot list in `docs/demo-video.md` | public YouTube/Vimeo URL requires final upload |

## Honest cloud-proof status

Local tests, CockroachDB vector queries, SAM validation, and SAM build are reproducible now. AWS account calls, CockroachDB Cloud Managed MCP, and `ccloud` require owner authentication. Scripts fail closed and should be captured only after authentication; they are not claimed as completed merely because configuration exists.
