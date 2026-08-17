# Task 10 report — Production Browser Journey

## Evidence

- RED: the old E2E startup command used an unsupported Next `--host` argument. The new harness starts an isolated, migrated Cockroach database and a real Stash router/API service for each run.
- RED: browser console evidence showed that the nonce-bearing CSP blocked Next client chunks rendered from the static layout. Making the nonce-dependent layout dynamic restored the real workspace session flow.
- RED: the live Lambda membership lookup returned PostgreSQL `42703` because it queried a nonexistent `principals.active` column. The real gateway then surfaced a `502`; the query now matches the migration schema.
- RED: mobile browser traces found lineage text intercepting `Rollback here`, then a cramped confirmation dialog intercepting the destructive action. The responsive layouts now keep both controls tappable.
- GREEN focused browser commands:
  - `npm run test:e2e -- --project=desktop -g 'creates an isolated'` — 1 passed (13.9s).
  - `npm run test:e2e -- --project=desktop -g 'quarantines a unique'` — 1 passed (13.0s).
  - `npm run test:e2e -- --project=desktop -g 'shows Inconclusive'` — 1 passed (15.7s).
  - `npm run test:e2e -- --project=desktop -g 'evaluates, approves'` — 1 passed (17.7s).
  - `npm run test:e2e -- --project=mobile -g 'evaluates, approves'` — 1 passed (16.5s).
- Full browser command: `npm run test:e2e` — 27 passed, 1 intentionally skipped desktop-only mobile-navigation assertion (42.0s).

## What the browser proves

Each run uses generated UUID identities and an isolated Cockroach database. The browser creates the real session/workspace, displays and reloads the persisted workspace ID, submits real proposals through Stash's own proxy and API routes, and verifies server-side poison quarantine, evaluation, approval, promotion, semantic retrieval, rollback, and generated audit request/resource IDs. It runs at desktop and iPhone viewport sizes, includes a keyboard-only review test, and scans all primary routes with axe.

The only deterministic double is the Bedrock semantic-judge adapter boundary in the E2E API harness. A run-scoped canonical payload marker produces the adapter's valid timeout/inconclusive result; no Stash API/read/write route is intercepted or fixture-backed.

## Release checks

- `npm run verify` — PASS: 31 unit files / 213 tests, 6 integration files / 28 tests, lint, typecheck, and production build.
- `npm run infra:validate` — PASS.
- `npm run infra:build` — PASS.
- `npm run production:audit` — PASS: `{"ok":true,"violations":[]}`.
- `git diff --check` — PASS.
- Complete required chain — `npm run verify && npm run test:e2e && npm run infra:validate && npm run infra:build && npm run production:audit` — PASS.

## Self-review and concerns

## Fix Round 1

- RED/GREEN: `src/services/ingest-candidate.test.ts` now proves Ed25519 verification over exact source content and proves a tampered body is not verified. The product dialog generates an Ed25519 browser keypair/signature; the server, not the client, verifies it.
- The proposal UI no longer submits a fixed embedding or an E2E timeout field. The server generates a normalized token-semantic vector, and retrieval uses that vector with a nonmatching-query negative assertion.
- The E2E harness now calls the actual sandbox trajectory executor and writes canonical evaluation artifacts to a real temporary local artifact store. The browser retrieves and validates the persisted artifact; only the Bedrock transport is locally adapted, including its marker-driven timeout.
- Full E2E after the correction: `npm run test:e2e` — 29 passed, 1 intentionally skipped (40.5s).
- The lexical embedding implementation is selected only for `STASH_E2E=1` or `NODE_ENV=test`; production requires `BEDROCK_EMBEDDING_MODEL_ID` and fails closed otherwise. Its selection test is in `src/services/embedding-provider.test.ts`.
- Follow-up verification after adding the strict provider selection is still required for the complete release chain.
- Post-final-change release chain: `npm run verify && npm run test:e2e && npm run infra:validate && npm run infra:build && npm run production:audit` — PASS. Verify: 32 unit files / 216 tests and 6 integration files / 28 tests; E2E: 29 passed, 1 intentional skip (39.2s); SAM validate/build and production audit passed.

- Session security remains strict: normal proxy mutations require same-origin requests and a verified workspace-session cookie. The E2E-only cookie exception is gated by `STASH_E2E=1` so local HTTP test cookies can be exercised; it is not enabled for production.
- The test harness gets its Cockroach admin URL from the existing integration-test configuration and creates/drops a unique database; it does not hardcode deployment credentials.
- Next emits pre-existing advisory warnings about `experimental.typedRoutes` and multiple lockfiles in this worktree. They do not fail the release gates.
- The application has no browser-exposed mechanism to manufacture a cryptographic signature. The safe lifecycle uses an observed, evidence-backed threshold change while the server retains the existing trust and review gates; Bedrock is the sole stubbed external boundary.

## Fix Round 2

- RED/GREEN provenance: the previous browser-generated public key was an unauthenticated trust root. `STASH_TRUSTED_SOURCE_KEYS` is now a validated server-only JSON registry keyed by stable identity and key ID. The UI submits only identity, key ID, and signature; the server verifies Ed25519 over canonical `{version,content}`, persists identity/key fingerprint/algorithm/signature/canonical payload/version, and downgrades an unverified claimed authenticated source to observed. Browser evidence signs with the E2E harness's corresponding private key and proves altered evidence is quarantined.
- RED/GREEN retrieval: active reads now obtain their query vector through the same injected `createEmbeddingProvider` contract used for ingestion and execute Cockroach vector search. The normalized lexical adapter is explicitly local E2E/test-only; production fails closed without a managed Bedrock embedding model. Browser evidence retrieves the promoted unique policy using a paraphrase with no literal overlap and excludes it for a nonmatching distractor.
- Audit evidence is response-correlated, not first-match: Playwright observes each screen/evaluate/review/promote/rollback response `x-request-id`, then asserts exactly that request ID and exact candidate/memory ID on the authoritative audit event.
- Session cookies are now always `Secure`; the E2E/Host loopback downgrade was removed. The regression test proves `STASH_E2E=1` cannot clear the Secure attribute. Desktop and mobile browser journeys both retained their real session on loopback.
- The E2E harness now registers idempotent cleanup before migration/service setup, cleans pool/server/artifacts/unique database on setup errors and normal stop, and rejects listen errors rather than hanging.

### Fix Round 2 evidence

- Focused RED/GREEN: `npm run test -- --run src/services/ingest-candidate.test.ts app/api/session/route.test.ts` — 17 passed; `npm run test:e2e -- --project=desktop -g 'evaluates, approves'` — 1 passed; `npm run test:e2e -- --project=mobile tests/e2e/poison-and-promote.spec.ts` — 4 passed.
- Full post-change chain: `npm run verify && npm run test:e2e && npm run infra:validate && npm run infra:build && npm run production:audit` — PASS. `verify`: 32 unit files / 217 tests and integration suite; E2E includes desktop/mobile persisted lifecycle journeys; infrastructure validate/build and production audit completed successfully.

### Corrected concerns

- The local embedding adapter and Bedrock semantic-judge adapter exist only at the E2E/test external-provider boundary. Production has no lexical embedding fallback and requires managed Bedrock configuration. Task 11 remains responsible for live AWS provider deployment.
- The test-only trusted private key is confined to the Playwright spec; the server sees only its configured public registry entry. No private key is exposed through the product UI or production configuration.

## Fix Round 3

- Elevated provenance is now symmetric: both `authenticated` and `authoritative` require identity, trusted key ID, Ed25519 algorithm, and signature at the API/UI boundary. The server independently resolves and verifies all four; untrusted or tampered elevated evidence is persisted as observed and is screened as an unverified signature attempt.
- Source evidence now includes the server-resolved, normalized SPKI Ed25519 public key and immutable registry version alongside key fingerprint, signature, algorithm, canonical signed payload, and payload version. Independent re-verification operates only on that persisted evidence, so an active-registry rotation/removal cannot rewrite historical authenticity.
- Forward migration `010_trusted_source_signature_evidence.sql` invalidates legacy `signature_verified=true` rows that lack complete trusted evidence and downgrades both source and candidate provenance. The isolated Cockroach migration test verifies source/candidate upgrade behavior.

### Fix Round 3 evidence

- RED/GREEN: `npm run test -- --run src/services/ingest-candidate.test.ts` — 10 passed, including authenticated/authoritative unsigned and tampered/untrusted cases plus persisted-key re-verification.
- `npm run test:integration -- --run src/db/migrations.integration.test.ts src/services/memory-release.integration.test.ts` — 13 passed, including the legacy-signature migration path.
- `npm run test:e2e -- --project=desktop tests/e2e/poison-and-promote.spec.ts` — 4 passed.

## Fix Round 4

- Migration `011_harden_legacy_elevated_provenance.sql` now downgrades every elevated source with incomplete trusted evidence, independent of the legacy `signature_verified` value, and consistently downgrades only candidates referencing that tenant-local source. Complete trusted evidence remains elevated.
- Source evidence is insert-once: the server attempts an insert and, on a reused tenant/source ID, compares the complete immutable provenance envelope/key/signature/fingerprint/version before allowing reuse; a mismatch raises a safe conflict before candidate creation.
- Registry keys use nested identity/key-ID maps rather than colon concatenation. The signed envelope now binds envelope version, identity, key ID, and content; persisted canonical evidence is the exact envelope verified by the server.

### Fix Round 4 evidence

- RED/GREEN: `npm run test -- --run src/services/source-signature.test.ts src/services/ingest-candidate.test.ts` — 12 passed, including delimiter collision and identity replay rejection.
- `npm run test:integration -- --run src/db/migrations.integration.test.ts` — 10 passed with the full migration manifest.
- Dedicated persistence regression: `npm run test:integration -- --run src/db/repositories.integration.test.ts` — 8 passed. It creates a trusted historical source/candidate, accepts exact same-tenant evidence reuse, rejects changed signed content, preserves/re-verifies the original evidence and historical candidate, and proves same source UUID independence in a second tenant.

## Fix Round 5

- RED/GREEN migration hardening: SQL `<> 'ed25519'` does not match NULL, so a legacy row with every other evidence field populated but a NULL algorithm could retain elevated trust. Migration 011 now explicitly treats `signature_algorithm IS NULL` as invalid in both source and candidate predicates. The upgrade fixture proves the source and its referencing candidate downgrade from authoritative while the old verified flag is cleared.
- Focused evidence: `npm run test:integration -- --run src/db/migrations.integration.test.ts` — 10 passed.
