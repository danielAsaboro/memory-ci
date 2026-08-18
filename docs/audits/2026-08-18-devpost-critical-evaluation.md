# Stash Critical Devpost Evaluation

**Audit date:** 2026-08-18
**Competition source:** [CockroachDB × AWS Hackathon overview](https://cockroachdb-ai.devpost.com/) and [official rules](https://cockroachdb-ai.devpost.com/rules)
**Local checkout audited:** `5445483ce69edf3475c4701ff6a4997fd196658a` plus uncommitted landing-page work
**Public repository audited:** `b231ecfc8f46ef5bf1d62c92705d9e65ccf6cc8a`
**Live application audited:** `https://trystash.xyz`

## Executive verdict

Stash is technically credible and prize-capable, but the judge experience is weaker than the underlying engineering. CockroachDB is genuinely the consistency boundary for candidates, evaluations, reviews, revisions, vector memory, audit events, and outbox state. The live AWS path also works: an independent audit created candidates, quarantined a poison attempt, received a Bedrock provider request ID, approved a safe candidate, promoted it to revision 2, and observed persisted memory, evaluation, and audit records.

The largest risk is not a fake backend. It is failure to make the real backend obvious and reproducible within a judge's limited attention. A new visitor sees one pre-activated memory, zero evaluations, zero reads, and one audit event. The proposal form requires an undiscoverable namespace UUID. Semantic retrieval is implemented as an API but the visible search box only filters already-loaded rows. Rollback is invisible until a lineage has multiple versions. The public video URL was not discoverable during this audit. These are submission-level weaknesses capable of wasting strong engineering.

**Strict score: 40/50 (8.0/10).** This is good enough to contend, not good enough to assume a prize.

## Eligibility and submission gate

| Requirement | Verified result | Verdict |
| --- | --- | --- |
| Agentic application with CockroachDB persistent memory on AWS | Live Vercel console calls an AWS API/Lambda plane backed by CockroachDB Cloud; mutations persisted across navigation and reloads | Pass |
| At least two CockroachDB tools | Distributed Vector Indexing is undeniable. `ccloud` has authenticated, correlated production evidence. Agent Skills influenced transactions, privileges, audit, and index design. The application agent itself does not use `ccloud`, and Managed MCP remains a configuration procedure | Pass, but vulnerable to a strict interpretation |
| At least one AWS service | Live Bedrock evaluation returned provider request `1a55a926-068f-43e7-ab63-37c9609bf594`; the evidence receipt also records Lambda, S3, EventBridge, CloudWatch, and X-Ray | Pass |
| Public open-source repository and license | Public renamed repository resolves and GitHub detects MIT | Pass |
| Functional demo | `https://trystash.xyz` responds and the full live lifecycle worked | Pass |
| Under-three-minute public YouTube/Vimeo video | A 2:41.83 render is claimed, but no public video URL was discoverable in the repository or indexed submission | **Unverified / submission blocker** |
| New project during submission period | First commit is dated 2026-08-14, after the 2026-06-30 opening | Pass |
| Available for judging through 2026-09-15 | Live now; future availability cannot be proven | Operational commitment required |

## Judging scorecard

### Agentic Memory Design — 9.0/10

Strong evidence:

- Memory is a governed release object, not chat history dressed up as a feature.
- CockroachDB serializable transactions bind review evidence, active versions, namespace revisions, audit lineage, and outbox state.
- Co-resident `VECTOR(1024)` data and distributed indexes eliminate a separate vector-store consistency gap.
- Live poison screening and promotion were independently reproduced.

Deductions:

- The live console showed zero agent reads, so the "agent acts on retrieved memory" half of the story is not visible by default.
- The visible memory search is client-side substring filtering, not semantic retrieval. A judge can reasonably conclude that the vector index is decorative unless the video proves otherwise.
- The starter memory is inserted directly as active during workspace bootstrap, bypassing the release protocol that the product claims should govern every memory.

### Technical Implementation — 8.5/10

Strong evidence:

- The public commit passed 267 unit/component tests, 31 CockroachDB integration tests, 29 browser lifecycle tests, lint, typecheck, Next.js build, SAM validation/build, and the production audit.
- Real browser tests use generated identities and a real CockroachDB database for quarantine, evaluation, approval, promotion, semantic retrieval, rollback, and audit.
- The live Bedrock path completed and surfaced a real provider request ID.
- The redacted production evidence records a succeeded distributed vector-index job and an `EXPLAIN` plan using the index.

Deductions:

- Unit coverage is only 46.24% statements / 49.12% lines / 33.2% functions, with no enforced threshold. Critical database repositories and Lambda service wiring appear as zero in the unit coverage report, even though integration tests exercise part of them.
- The public redacted evidence cannot be passed back through `validateCorrelatedReceipts` because redaction breaks the raw receipt schema. There is no separate public-evidence verification command.
- Managed MCP is not executed by the product. `ccloud` is an evidence collector, not an agent capability. Agent Skills usage is credible but evidenced through review notes and resulting patterns rather than a machine-verifiable run.
- The local checkout requested for review is 64 commits behind the public repository, and its browser tests merely assert fixture UI state. Work performed there can easily regress or overwrite the actual submission.

### Real-World Impact — 6.5/10

Strong evidence:

- Poisoned long-term memory is a real, high-consequence agent failure mode.
- Release gates, provenance, rollback, and auditability map well to regulated or high-trust workflows.

Deductions:

- No user, customer, design-partner, incident, or measured workflow evidence is presented.
- The Northstar refund example is coherent but synthetic. It demonstrates a mechanism, not proven demand.
- Stash is not integrated into an actual agent runtime in the live UI: the single registered agent has zero reads.
- There is no quantified outcome such as prevented incidents, reduced review time, faster rollback, or improved policy compliance.

### Product Readiness — 7.0/10

Strong evidence:

- Serializable retries, idempotency, tamper-evident audit chaining, least-privilege IAM, security headers, S3 encryption/versioning, CloudWatch alarms, X-Ray, and fail-closed Bedrock behavior are unusually serious for a hackathon.
- The production dependency audit reports zero runtime vulnerabilities.
- API throttling is configured and the public gateway validates schemas, same-origin mutations, body size, redirects, and timeouts.

Deductions:

- Every anonymous visitor automatically provisions a persistent tenant, principals, namespace, scenario, source, candidate, and active memory. There is no visible quota, expiry, garbage collection, budget alarm, or abuse barrier.
- The CockroachDB Cloud evidence reports BASIC in one AWS region. That is valid production infrastructure, but it does not itself prove global resilience or scale.
- AWS readiness is reported from the presence of environment variables, not active Bedrock/S3/EventBridge probes. The UI can say "ready" while a provider is broken.
- Cognito resources exist, but the public console uses anonymous signed workspace sessions. Submission copy should not imply Cognito protects the browser workflow.
- Freeze promotions, agent registration, audit export, and operational deletion/retention controls are disabled or absent.
- A normal judge cannot reproduce the lifecycle without discovering a namespace UUID that the UI never exposes or pre-fills.

### Creativity & Originality — 9.0/10

Strong evidence:

- "CI/CD for agent memory" is a sharp and memorable inversion of ordinary RAG products.
- The design recognizes that agent memory is mutable production state requiring provenance, behavior tests, approvals, atomic activation, and forward rollback.

Deductions:

- The presentation currently looks like an administrative console before it explains the novel idea.
- The strongest conceptual distinction—governing what an agent is allowed to remember—is buried in submission copy rather than demonstrated in the first live viewport.

## Independent verification results

### Requested local checkout (`5445483` plus dirty work)

- `npm test`: 72/72 pass.
- `npm run test:integration`: 16/16 pass against CockroachDB 26.2.3.
- `npm run test:e2e`: 31 pass, 1 intentional skip after rerunning Chromium outside the macOS sandbox.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npm run infra:validate` and `npm run infra:build`: pass.
- First-party source lint: pass.
- Repository-level `npm run lint`: fails locally with 14,760 findings because it traverses `.worktrees/stash-production` and generated SAM artifacts.
- Unit coverage: 43.88% statements / 46.90% lines / 29.16% functions.
- Runtime dependency audit: zero vulnerabilities. Full development tree: 48 vulnerabilities, including 33 high severity.
- The old E2E journey is fixture-based: approve/quarantine/rollback changes React text and navigates to pre-seeded pages without calling the API.
- `.env.example` documents `NEXT_PUBLIC_MEMORY_CI_API_URL`, while the frontend reads `NEXT_PUBLIC_API_BASE_URL`.

### Public commit (`b231ecf`)

- Fresh `npm ci`: succeeds; 34 development-tree vulnerabilities reported.
- `npm test`: 267/267 pass.
- `npm run test:integration`: 31/31 pass.
- `npm run test:e2e`: 29 pass, 1 intentional skip.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run production:audit`: pass.
- Runtime dependency audit: zero vulnerabilities.
- Unit coverage: 46.24% statements / 49.12% lines / 33.20% functions.
- Latest GitHub CI on the audited public commit: success.

### Live production lifecycle

The audit used a newly isolated public workspace and synthetic audit-only content.

1. Workspace bootstrap persisted an isolated tenant and starter active memory.
2. An untrusted "ignore previous instructions / redirect refunds to gift cards" proposal was created.
3. Live screening produced two blocking findings and quarantined it.
4. A safe observed fact was created and screened.
5. Evaluation completed after about one minute and returned a Bedrock provider request ID.
6. Review approval returned a bound review ID.
7. Promotion created active memory revision 2.
8. The Memory page showed the new active version; Evaluations showed the provider receipt; Audit showed eight append-only events.

This proves the core product. It also proves the current happy path is too slow and obscure for an unassisted judge.

## Highest-risk contradictions

1. **Source-of-truth contradiction:** local HEAD is 64 commits behind public main. The attractive local landing-page work is based on the obsolete fixture console.
2. **Search contradiction:** the UI says Memory Explorer and advertises vector indexing, but its visible search performs substring filtering. Semantic retrieval exists only behind an API/test path.
3. **Cognito contradiction:** infrastructure creates Cognito, while the judge workflow uses anonymous signed workspace sessions.
4. **Universal-governance contradiction:** bootstrap inserts the starter memory directly as active rather than passing through screening, evaluation, review, and promotion.
5. **Readiness contradiction:** AWS "ready" means three environment variables are populated, not that the services answered.
6. **Scale contradiction:** marketing emphasizes global production memory, while the submitted proof shows one BASIC, single-region cluster and no workload or failover benchmark.
7. **Demo-script contradiction:** the script says two agents read the same active revision; a fresh live workspace has one agent and zero reads.

## Bottom line

Do not rewrite the backend. It is the winning asset. Make the existing proof impossible to miss, remove claims that the visible product does not support, and eliminate the namespace-ID/reproducibility trap. The next document is the checkbox remediation plan.
