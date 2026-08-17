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

- Session security remains strict: normal proxy mutations require same-origin requests and a verified workspace-session cookie. The E2E-only cookie exception is gated by `STASH_E2E=1` so local HTTP test cookies can be exercised; it is not enabled for production.
- The test harness gets its Cockroach admin URL from the existing integration-test configuration and creates/drops a unique database; it does not hardcode deployment credentials.
- Next emits pre-existing advisory warnings about `experimental.typedRoutes` and multiple lockfiles in this worktree. They do not fail the release gates.
- The application has no browser-exposed mechanism to manufacture a cryptographic signature. The safe lifecycle uses an observed, evidence-backed threshold change while the server retains the existing trust and review gates; Bedrock is the sole stubbed external boundary.
