# Task 12 report — Stash production cutover

## Outcome

- Vercel project `harmonia-b4a76411/stash` linked to the expected project ID.
- Production-only Vercel variables configured by stdin: `STASH_API_BASE_URL`, `STASH_BOOTSTRAP_KEY`, `STASH_SESSION_SECRET`, and `NEXT_PUBLIC_APP_URL`.
- Vercel production deployment reached `READY` and `https://trystash.xyz` was aliased to it.
- CockroachDB Cloud migrations 001–013 applied with exact SQL-cluster identity and ledger verification.
- AWS stack `stash-production` reached `UPDATE_COMPLETE` after the production lifecycle fixes.
- Public-facing name, URLs, architecture, setup, evidence, and submission copy now use Stash.

## Production defects found and fixed by the live gate

1. API Gateway stage paths were duplicated or dropped by the initial smoke URL construction. URL builders now preserve the stage exactly.
2. `ccloud` evidence now consumes the real array/snake-case JSON contract and distinguishes Cloud resource ID, SQL cluster ID, and organization ID.
3. The original vector index could not serve active-memory retrieval. Migration 012 creates `memory_versions_active_embedding_idx`; evidence requires its exact succeeded job and indexed `EXPLAIN` plan.
4. CloudWatch raw term filters did not match hyphenated evidence UUIDs. The collector uses a safely quoted exact term and retains post-fetch equality checks.
5. Bedrock evaluator logs use `Converse`, while embedding logs use `InvokeModel` with request metadata. Final evidence strictly correlates each real operation to its exact provider request.
6. Production workspaces had no behavioral scenario, so evaluation correctly failed closed. Migration 013 backfills the refund safety scenario, and workspace bootstrap now creates it transactionally for every new tenant.
7. The outbox role authorized a foundation-model ARN constructed from an inference-profile ID. It now has least-privilege access to the Haiku inference profile and its three underlying regional foundation models.
8. The live Playwright gate now honors `PLAYWRIGHT_BASE_URL`, allows AWS's bounded asynchronous evaluation window, uses the production-safe observed-trust path when no private signing key is available, verifies S3 artifact URI shape, and keeps synthetic provider timeout injection local-only.

## Evidence captured

- Generated `docs/evidence/stash-production.json` with one correlated live AWS/CockroachDB run.
- Canonical HTML: Stash present; `Memory CI`, `chatgpt.site`, and `Sandbox fixture` absent.
- Session POST: 201 with a persisted workspace and Secure/HttpOnly cookie.
- Security headers: CSP and HSTS present.
- Focused live lifecycle: evaluation, approval, promotion, semantic retrieval, rollback, and exact audit correlation passed.
- Focused live keyboard path: desktop and mobile passed.
- Complete live suite before the final keyboard synchronization fix: 25 passed, 3 intentional skips, 2 keyboard races; the corrected keyboard test then passed 2/2 live.

## Remaining release steps

- Run the complete local release gate after all final source changes.
- Deploy the final Vercel source snapshot, commit, update the Git remote, push `main`, and inspect GitHub Actions.
