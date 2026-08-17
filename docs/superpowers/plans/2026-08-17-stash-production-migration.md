# Stash Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Memory CI to Stash and ship a real, persistent agent-memory release application at `https://trystash.xyz` using Vercel, AWS, and CockroachDB Cloud.

**Architecture:** A standard Next.js application on the existing Vercel `stash` project renders the console and proxies same-origin requests. API Gateway and Lambda run the authoritative lifecycle services on AWS; CockroachDB Cloud stores transactional and vector memory; Bedrock evaluates candidates; S3 stores evidence; EventBridge receives committed lifecycle events. Visitors receive isolated, signed workspaces whose state survives refreshes.

**Tech Stack:** TypeScript 5.9, Next.js 16, React 19, TanStack Query 5, Zod 4, PostgreSQL client 8, CockroachDB Cloud, AWS Lambda/API Gateway/Bedrock/S3/EventBridge/Secrets Manager/CloudWatch/X-Ray, AWS SAM, Vercel, Vitest, Playwright, Axe.

**Spec:** `docs/superpowers/specs/2026-08-17-stash-production-migration-design.md`

## Global Constraints

- Canonical product name: `Stash`.
- Canonical production URL: `https://trystash.xyz`.
- Canonical public repository: `https://github.com/danielAsaboro/stash-cockcroachdb`.
- Vercel project: `harmonia-b4a76411/stash`.
- Node.js runtime: `>=22.13.0`; Vercel project runtime: `24.x`.
- AWS remains the authoritative application execution plane.
- CockroachDB remains the persistent transactional and vector-memory system of record.
- Existing database table names and applied migration history remain unchanged.
- Provider timeout, malformed output, missing required evidence, or stale bindings never produce a successful decision.
- Browser bundles never contain database, AWS, or session-signing credentials.
- Public UI must not claim an integration is live until an authenticated production call is verified.

---

### Task 1: Standard Next.js Runtime and Stash Identity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Create: `next.config.ts`
- Delete: `vite.config.ts`
- Delete: `worker/index.ts`
- Delete: `build/sites-vite-plugin.ts`
- Delete: `.openai/hosting.json`
- Modify: `app/layout.tsx`
- Modify: `app/components/app-shell.tsx`
- Modify: `app/globals.css`
- Rename: `public/memory-ci-social.png` to `public/stash-social.png`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Existing App Router pages and React components.
- Produces: A standard Next.js 16 build with `Stash` metadata and no Cloudflare/vinext runtime dependency.

- [ ] **Step 1: Write the rendered identity assertions**

Add assertions that the production HTML contains `Stash`, references `https://trystash.xyz`, and contains neither `Memory CI` nor `Sandbox demo`.

```js
assert.match(html, />Stash</);
assert.match(html, /https:\/\/trystash\.xyz/);
assert.doesNotMatch(html, /Memory CI|Sandbox demo|chatgpt\.site/);
```

- [ ] **Step 2: Run the identity test and verify it fails**

Run: `npm run test:starter`

Expected: FAIL because the current metadata and shell still say `Memory CI` and the build uses vinext.

- [ ] **Step 3: Replace the runtime packages and scripts**

Set package name to `stash`, add `next@16.2.6`, change scripts to `next dev`, `next build`, and `next start`, and remove `vinext`, `vite`, `wrangler`, `@cloudflare/vite-plugin`, `@vitejs/plugin-react`, `@vitejs/plugin-rsc`, and `@openai/sites-vite-plugin`. Regenerate the lockfile with `npm install`.

```json
{
  "name": "stash",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

- [ ] **Step 4: Add the Vercel-compatible Next.js configuration**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { typedRoutes: true },
};

export default nextConfig;
```

Remove Cloudflare-specific compiler types from `tsconfig.json` and retain the `@/*` path mapping.

- [ ] **Step 5: Apply Stash branding**

Set metadata base to `https://trystash.xyz`, use the title template `%s · Stash`, rename the social image, update brand copy, replace the shield mark with the existing brand treatment labeled `Stash`, and change the environment card to show runtime status supplied later by `WorkspaceProvider`.

- [ ] **Step 6: Run targeted and production checks**

Run: `npm run test:starter && npm run typecheck && npm run build`

Expected: PASS with a standard `.next` production build.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts app public tests worker build vite.config.ts
git commit -m "feat: migrate Stash console to Next.js"
```

---

### Task 2: Signed Workspace Sessions

**Files:**
- Create: `src/auth/workspace-session.ts`
- Create: `src/auth/workspace-session.test.ts`
- Create: `src/contracts/workspace.ts`
- Create: `app/api/session/route.ts`
- Create: `app/api/session/route.test.ts`
- Delete: `app/chatgpt-auth.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `WorkspaceSession`, `signWorkspaceSession(input, secret, now?)`, `verifyWorkspaceSession(token, secret, now?)`, and `POST /api/session`.
- `WorkspaceSession`: `{ tenantId: string; principalId: string; roles: readonly string[]; workspaceName: string; expiresAt: number }`.
- Cookie name: `stash_session`; algorithm: HS256; audience: `stash-api`; issuer: `https://trystash.xyz`; maximum age: 86,400 seconds.

- [ ] **Step 1: Write failing token tests**

Test round-trip claims, wrong secret, wrong audience, and an expired token.

```ts
const token = await signWorkspaceSession(session, secret, new Date("2026-08-17T00:00:00Z"));
await expect(verifyWorkspaceSession(token, secret, new Date("2026-08-17T00:01:00Z"))).resolves.toMatchObject({ tenantId: "tenant-1" });
await expect(verifyWorkspaceSession(token, "wrong-secret")).rejects.toMatchObject({ code: "unauthorized" });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/auth/workspace-session.test.ts`

Expected: FAIL because `workspace-session.ts` does not exist.

- [ ] **Step 3: Implement signing and verification**

Use `jose` `SignJWT` and `jwtVerify`; require a secret of at least 32 bytes; validate decoded claims with Zod; convert every verification failure into `DomainError("unauthorized", "Workspace session is invalid or expired.")`.

- [ ] **Step 4: Write the session-route contract test**

Assert `POST /api/session` forwards to `${STASH_API_BASE_URL}/v1/workspaces`, passes a unique `Idempotency-Key`, stores `stash_session` as `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/"`, and returns only safe workspace metadata.

- [ ] **Step 5: Implement the session route**

Validate `STASH_API_BASE_URL` and `STASH_SESSION_SECRET` on the server. Reuse a valid cookie; otherwise call the AWS workspace bootstrap endpoint, sign the returned identity, and set the cookie. Do not expose the AWS bootstrap secret or session token in JSON.

- [ ] **Step 6: Run session tests**

Run: `npx vitest run src/auth/workspace-session.test.ts app/api/session/route.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth src/contracts/workspace.ts app/api/session .env.example app/chatgpt-auth.ts
git commit -m "feat: add isolated Stash workspace sessions"
```

---

### Task 3: Transactional Workspace Bootstrap

**Files:**
- Create: `db/migrations/005_workspace_sessions.sql`
- Create: `src/db/workspaces.ts`
- Create: `src/services/bootstrap-workspace.ts`
- Create: `src/services/bootstrap-workspace.integration.test.ts`
- Modify: `src/lambda/services.ts`

**Interfaces:**
- Consumes: `withTenantTransaction(pool, tenantId, operation)` and CockroachDB schema.
- Produces: `bootstrapWorkspace(pool, { idempotencyKey, displayName }): Promise<WorkspaceBootstrap>`.
- `WorkspaceBootstrap`: `{ tenantId: string; principalId: string; workspaceName: string; namespaceId: string; agentId: string; roles: ["admin", "reviewer"] }`.

- [ ] **Step 1: Write the failing bootstrap integration tests**

Verify one call creates a tenant, principal, namespace, agent, source, initial active memory, lineage, revision, and immutable audit event. Verify repeating the same idempotency key returns the same identifiers and creates no duplicates. Verify a different key creates an isolated tenant.

- [ ] **Step 2: Run the bootstrap integration test and verify it fails**

Run: `npm run test:integration -- src/services/bootstrap-workspace.integration.test.ts`

Expected: FAIL because the migration and service do not exist.

- [ ] **Step 3: Add the bootstrap idempotency schema**

Create `workspace_bootstraps` keyed by `idempotency_key`, with tenant, principal, namespace, agent, workspace name, and timestamps. Grant the runtime role only the permissions needed by bootstrap and tenant-scoped reads.

- [ ] **Step 4: Implement one-transaction bootstrap**

Insert ordinary production records using generated UUIDs. Seed a signed Northstar refund policy as the initial active memory, revision `1`, without inserting evaluation successes or quarantined candidates. Append `workspace.created` to the audit chain.

- [ ] **Step 5: Run migrations and bootstrap tests**

Run: `npm run test:integration -- src/services/bootstrap-workspace.integration.test.ts src/db/migrations.integration.test.ts`

Expected: PASS, including idempotent retry.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/005_workspace_sessions.sql src/db/workspaces.ts src/services/bootstrap-workspace.ts src/services/bootstrap-workspace.integration.test.ts src/lambda/services.ts
git commit -m "feat: bootstrap persistent Stash workspaces"
```

---

### Task 4: Live Read Models and API Routes

**Files:**
- Create: `src/contracts/dashboard.ts`
- Create: `src/services/read-workspace.ts`
- Create: `src/services/read-workspace.integration.test.ts`
- Modify: `src/api/router.ts`
- Modify: `src/api/router.test.ts`
- Modify: `src/lambda/services.ts`

**Interfaces:**
- Produces: `getOverview`, `listAgents`, `listMemories`, `getMemory`, `listEvaluations`, `getEvaluation`, `listCandidates`, `getCandidate`, `listAudit`, and `getWorkspaceStatus` services.
- Routes: `GET /v1/overview`, `/v1/agents`, `/v1/memory`, `/v1/memory/:memoryId`, `/v1/evaluations`, `/v1/evaluations/:evaluationRunId`, `/v1/candidates`, `/v1/candidates/:candidateId`, `/v1/audit`, `/v1/workspace/status`.

- [ ] **Step 1: Write failing tenant-scoped read tests**

Seed two workspaces and assert every read model returns only the caller's rows. Assert counters are computed from persisted records rather than fixed constants.

- [ ] **Step 2: Run and verify failure**

Run: `npm run test:integration -- src/services/read-workspace.integration.test.ts`

Expected: FAIL because read services are absent.

- [ ] **Step 3: Define strict response schemas**

Use Zod schemas for timestamps, identifiers, lifecycle states, integration status, overview metrics, candidate summaries, memory summaries, evaluation summaries, agents, lineage, and audit events. Export inferred TypeScript types for the frontend.

- [ ] **Step 4: Implement query services**

Use parameterized SQL through tenant transactions. Select only UI-required columns, order deterministically, return ISO timestamps, and calculate vector-index readiness with a database health query rather than a hard-coded `ready` value.

- [ ] **Step 5: Extend the router**

Add the routes above, remove `/v1/demo/reset`, `/v1/demo/poison-attempt`, and `/v1/demo/policy-update`, and update `ApiServices` to contain the exact live-service names.

- [ ] **Step 6: Run router and integration tests**

Run: `npx vitest run src/api/router.test.ts && npm run test:integration -- src/services/read-workspace.integration.test.ts`

Expected: PASS and no production demo routes.

- [ ] **Step 7: Commit**

```bash
git add src/contracts/dashboard.ts src/services/read-workspace.ts src/services/read-workspace.integration.test.ts src/api src/lambda/services.ts
git commit -m "feat: expose tenant-scoped Stash read models"
```

---

### Task 5: Lambda Session Authentication and Bootstrap Endpoint

**Files:**
- Modify: `src/auth/workspace-session.ts`
- Modify: `src/lambda/api.ts`
- Modify: `src/lambda/api.test.ts`
- Modify: `infra/template.yaml`
- Modify: `infra/parameters.example.json`

**Interfaces:**
- Consumes: `verifyWorkspaceSession` and `bootstrapWorkspace`.
- Produces: public rate-limited `POST /v1/workspaces` bootstrap route and authenticated lifecycle routes accepting `Bearer <stash-session-jwt>`.

- [ ] **Step 1: Write failing Lambda authentication tests**

Assert bootstrap succeeds with a valid server bootstrap key and idempotency key; lifecycle calls succeed with a signed Stash session; missing, expired, or cross-tenant sessions return `401` or `403`; raw Cognito claim injection is ignored.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/lambda/api.test.ts`

Expected: FAIL because Lambda currently requires Cognito event claims.

- [ ] **Step 3: Replace event-claim trust with token verification**

Read `Authorization` from the request, verify issuer, audience, expiry, tenant, principal, and roles, and check active principal membership in CockroachDB. Keep `/health` unauthenticated and return a safe readiness body.

- [ ] **Step 4: Add bootstrap handling and throttling controls**

Require `X-Stash-Bootstrap-Key`, `Idempotency-Key`, a bounded display name, and API Gateway throttling. Return only `WorkspaceBootstrap`; Vercel signs the browser session.

- [ ] **Step 5: Update the SAM template**

Add `StashSessionSecret`, `StashBootstrapKey`, `AllowedOrigin=https://trystash.xyz`, API Gateway throttling, and least-privilege secret access. Rename AWS display resources from `memory-ci-*` to `stash-*` where replacement is safe; preserve database identifiers.

- [ ] **Step 6: Run tests and validate infrastructure**

Run: `npx vitest run src/lambda/api.test.ts && npm run infra:validate && npm run infra:build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/auth/workspace-session.ts src/lambda/api.ts src/lambda/api.test.ts infra
git commit -m "feat: secure Stash API with workspace sessions"
```

---

### Task 6: Same-Origin Gateway and Typed Client

**Files:**
- Create: `app/api/stash/[...path]/route.ts`
- Create: `app/api/stash/[...path]/route.test.ts`
- Rewrite: `app/lib/api-client.ts`
- Create: `app/lib/api-client.test.ts`
- Create: `app/lib/workspace-provider.tsx`
- Modify: `app/lib/query-client.tsx`

**Interfaces:**
- Produces: `stashQuery<T>(path, schema)`, `stashMutation<TInput,TOutput>(path, input, schema, idempotencyKey?)`, `useWorkspace()`, and same-origin `/api/stash/*` proxying.
- Error type: `StashApiError { code: string; message: string; requestId: string; status: number }`.

- [ ] **Step 1: Write failing proxy security tests**

Assert the proxy rejects absent cookies, forwards only allowlisted headers, generates request IDs, adds the signed bearer token server-side, preserves `Idempotency-Key`, enforces a 64 KiB body limit, and never returns secrets.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run app/api/stash/'[...path]'/route.test.ts app/lib/api-client.test.ts`

Expected: FAIL because the gateway and typed client do not exist.

- [ ] **Step 3: Implement the gateway**

Permit only known `/v1` paths and methods, require same-origin on mutations, read and verify `stash_session`, forward to `STASH_API_BASE_URL`, apply an abort timeout, and copy only `content-type`, `x-request-id`, and safe cache headers back to the browser.

- [ ] **Step 4: Implement the typed client**

Use relative `/api/stash` URLs, `cache: "no-store"`, Zod response parsing, generated idempotency keys for mutations, and structured error parsing. Remove the fallback fixture readiness response.

- [ ] **Step 5: Implement workspace bootstrap state**

`WorkspaceProvider` calls `POST /api/session` once when no valid workspace exists, exposes `loading | ready | error`, and invalidates all TanStack queries when a new workspace is created.

- [ ] **Step 6: Run tests**

Run: `npx vitest run app/api/stash/'[...path]'/route.test.ts app/lib/api-client.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api app/lib
git commit -m "feat: connect Stash console to the live API"
```

---

### Task 7: Replace Fixture-Backed Pages with Live Queries

**Files:**
- Delete: `app/lib/demo-data.ts`
- Modify: `app/overview/page.tsx`
- Modify: `app/changes/page.tsx`
- Modify: `app/changes/[candidateId]/page.tsx`
- Modify: `app/memory/page.tsx`
- Modify: `app/memory/[memoryId]/page.tsx`
- Modify: `app/evaluations/page.tsx`
- Modify: `app/agents/page.tsx`
- Modify: `app/audit/page.tsx`
- Modify: `app/onboarding/page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/components/change-queue.tsx`
- Modify: `app/components/memory-explorer.tsx`
- Modify: `app/components/evaluation-matrix.tsx`
- Modify: `app/components/audit-timeline.tsx`
- Modify: `app/components/onboarding-checklist.tsx`
- Create: `app/components/async-state.tsx`
- Create: `app/components/live-pages.test.tsx`

**Interfaces:**
- Consumes: Typed contracts and query helpers from Tasks 4 and 6.
- Produces: All primary routes rendered from live workspace data with loading, empty, failure, and success states.

- [ ] **Step 1: Write failing live-page tests**

Mock only the HTTP boundary. Assert overview metrics and identity come from responses, candidates and memories render arbitrary server IDs, empty queues show a next action, provider failure is not styled healthy, and none of the rendered pages contain `Sandbox`, `fixture`, `cloud proof pending`, hard-coded `Amina`, revision `12`, or the three legacy candidate IDs.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run app/components/live-pages.test.tsx`

Expected: FAIL because pages import `demo-data.ts` and fixed copy.

- [ ] **Step 3: Add shared async states**

Create accessible skeleton, empty, inline retry, terminal error, and provider-degraded components. Errors show the safe message and request ID; they never render raw response bodies.

- [ ] **Step 4: Convert overview, candidates, and candidate detail**

Use TanStack queries keyed by workspace and record ID. Populate counters, status chips, provenance, findings, evidence, and review eligibility from API responses.

- [ ] **Step 5: Convert memory, evaluations, agents, audit, onboarding, and settings**

Render actual revisions, vector-index state, scenario outcomes, agent convergence, audit attribution, service readiness, and workspace identity. Remove the demo-reset affordance.

- [ ] **Step 6: Delete fixture data and rerun tests**

Run: `npx vitest run app/components/live-pages.test.tsx app/**/*.test.tsx && npm run typecheck`

Expected: PASS and `rg -n "demo-data|Sandbox fixture|Memory CI" app` returns no matches.

- [ ] **Step 7: Commit**

```bash
git add app
git commit -m "feat: render Stash from persistent workspace data"
```

---

### Task 8: Live Lifecycle Mutations and Evaluation Progress

**Files:**
- Create: `app/components/propose-memory-dialog.tsx`
- Create: `app/components/propose-memory-dialog.test.tsx`
- Modify: `app/components/review-actions.tsx`
- Create: `app/components/review-actions.test.tsx`
- Modify: `app/components/lineage-timeline.tsx`
- Modify: `app/components/behavioral-diff.tsx`
- Modify: `src/lambda/outbox.ts`
- Modify: `src/lambda/sandbox.ts`
- Modify: `src/services/evaluate-candidate.ts`
- Test: `src/services/evaluate-candidate.test.ts`

**Interfaces:**
- Consumes: Candidate lifecycle endpoints and typed client.
- Produces: Working propose, screen, evaluate, review, promote, retrieve, and rollback controls; bounded evaluation polling.

- [ ] **Step 1: Write failing mutation UI tests**

Assert proposal submits provenance and content, double-submit reuses an idempotency key, blocked candidates cannot approve, evaluation polls until terminal state, stale review refreshes evidence, promotion updates active memory, and rollback requires typed confirmation.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run app/components/propose-memory-dialog.test.tsx app/components/review-actions.test.tsx src/services/evaluate-candidate.test.ts`

Expected: FAIL because the current controls only update local status text.

- [ ] **Step 3: Implement proposal and screening flows**

Validate title, namespace, memory class, canonical text, trust class, source URI, and signature metadata. Submit candidate creation, then explicitly screen; display persisted findings and transition state.

- [ ] **Step 4: Implement evaluation and review flows**

Start evaluation, poll the operation at 1, 2, 4, then 5-second intervals with a 90-second UI ceiling, and render `inconclusive` distinctly from `failed` or `passed`. Approval sends the bound evaluation run and reason.

- [ ] **Step 5: Implement promotion and rollback flows**

Require explicit reason, preserve a mutation idempotency key through retries, invalidate candidate/memory/audit/overview queries after success, and display revision returned by the server.

- [ ] **Step 6: Verify outbox evaluation execution**

Ensure the dispatcher claims each event once, invokes the sandbox and Bedrock adapters, stores S3 receipts before completing the evaluation, and leaves retryable events unacknowledged on provider failure.

- [ ] **Step 7: Run targeted and integration tests**

Run: `npx vitest run app/components/propose-memory-dialog.test.tsx app/components/review-actions.test.tsx src/services/evaluate-candidate.test.ts && npm run test:integration`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/components src/lambda src/services/evaluate-candidate.ts src/services/evaluate-candidate.test.ts
git commit -m "feat: enable the live Stash release workflow"
```

---

### Task 9: Production Security and Configuration

**Files:**
- Modify: `src/db/client.ts`
- Modify: `src/aws/config.ts`
- Modify: `src/aws/database-secret.ts`
- Modify: `infra/template.yaml`
- Modify: `.env.example`
- Modify: `SECURITY.md`
- Create: `scripts/production-audit.ts`
- Create: `scripts/production-audit.test.ts`

**Interfaces:**
- Produces: `npm run production:audit`, which fails on demo copy, unsafe browser env keys, unconfigured canonical URLs, missing security headers, or source-map secret patterns.

- [ ] **Step 1: Write failing production-audit tests**

Build fixtures containing `NEXT_PUBLIC_DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, `chatgpt.site`, `Sandbox fixture`, and a missing Content Security Policy. Assert every fixture fails with a stable rule identifier.

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run scripts/production-audit.test.ts`

Expected: FAIL because the audit script does not exist.

- [ ] **Step 3: Implement configuration validation**

Require `DATABASE_SECRET_ARN`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `EVIDENCE_BUCKET`, `EVENT_BUS_NAME`, `STASH_SESSION_SECRET`, `STASH_BOOTSTRAP_KEY`, `STASH_API_BASE_URL`, and `NEXT_PUBLIC_APP_URL=https://trystash.xyz` in their correct server runtimes. Rename `application_name` to `stash`.

- [ ] **Step 4: Add platform security headers**

Configure CSP, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`, and HSTS on production. Restrict API CORS to `https://trystash.xyz`.

- [ ] **Step 5: Implement the audit script**

Scan source, built client chunks, metadata, environment key names, and response headers. Print machine-readable JSON and exit non-zero for any violation.

- [ ] **Step 6: Run security checks**

Run: `npx vitest run scripts/production-audit.test.ts && npm run build && npm run production:audit && npm run infra:validate`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db/client.ts src/aws infra .env.example SECURITY.md scripts package.json
git commit -m "security: harden Stash production boundaries"
```

---

### Task 10: Production Browser Journey

**Files:**
- Rewrite: `tests/e2e/onboarding.spec.ts`
- Rewrite: `tests/e2e/poison-and-promote.spec.ts`
- Rewrite: `tests/e2e/rollback-and-audit.spec.ts`
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: Running Next.js application and live/test API.
- Produces: A browser-level proof that a new workspace persists and the complete release lifecycle uses server state.

- [ ] **Step 1: Rewrite E2E assertions around generated identities**

Create a workspace, record its displayed workspace ID, reload, and assert the same ID returns. Propose unique content using the test run ID instead of relying on fixed candidate IDs.

- [ ] **Step 2: Add poison, promotion, search, and rollback journey**

Submit an untrusted gift-card directive and assert quarantine; submit a signed threshold change, evaluate, approve, and promote it; semantically retrieve the new active memory; roll back; then verify audit events contain the generated request and resource IDs.

- [ ] **Step 3: Add degraded-provider assertions**

Stub a Bedrock timeout at the API adapter boundary and assert the UI shows `Inconclusive`, disables approval, and never shows the evaluation as passed.

- [ ] **Step 4: Run desktop, mobile, and accessibility tests**

Run: `npm run test:e2e`

Expected: PASS for Chromium desktop, mobile viewport, keyboard-only review, persistence, and WCAG A/AA assertions.

- [ ] **Step 5: Run the complete local release gate**

Run: `npm run verify && npm run test:e2e && npm run infra:validate && npm run infra:build && npm run production:audit`

Expected: every command exits `0`.

- [ ] **Step 6: Commit**

```bash
git add tests playwright.config.ts
git commit -m "test: prove the live Stash lifecycle"
```

---

### Task 11: CockroachDB Cloud and AWS Deployment

**Files:**
- Modify: `infra/parameters.production.json` (gitignored)
- Create: `docs/evidence/stash-production.json`
- Modify: `scripts/cloud-evidence.ts`
- Modify: `scripts/aws-smoke.ts`

**Interfaces:**
- Consumes: Authenticated `ccloud` and AWS CLI sessions.
- Produces: Migrated CockroachDB cluster, deployed SAM stack, live API base URL, and redacted evidence receipts.

- [ ] **Step 1: Authenticate and select the lowest-cost production resources**

Run: `ccloud auth login` and `aws login`, then confirm identities with `ccloud auth whoami -o json` and `aws sts get-caller-identity`.

Expected: both commands return the intended user or service account without exposing credentials.

- [ ] **Step 2: Create or select CockroachDB Cloud**

Select a serverless/basic cluster in `us-east-1`, create database `stash`, run migrations `001` through `005`, create the least-privilege runtime role, and store the runtime connection string in AWS Secrets Manager. Do not commit the connection string.

- [ ] **Step 3: Verify distributed vector indexing**

Run: `npm run vector:evidence` with `DATABASE_URL` exported from the authenticated CockroachDB connection retrieved in Step 2.

Expected: evidence shows `VECTOR(1024)` columns and eligible distributed vector indexes on the production cluster.

- [ ] **Step 4: Deploy the SAM stack**

Run: `sam deploy --template-file .aws-sam/build/template.yaml --stack-name stash-production --region us-east-1 --capabilities CAPABILITY_IAM --parameter-overrides file://infra/parameters.production.json --resolve-s3 --no-confirm-changeset`

Expected: CloudFormation reaches `CREATE_COMPLETE` or `UPDATE_COMPLETE` and outputs the API URL, evidence bucket, event bus, and Cognito values retained for evidence even if Cognito is not browser-facing.

- [ ] **Step 5: Run authenticated cloud smoke tests**

Export the stack output with `STASH_API_BASE_URL=$(aws cloudformation describe-stacks --stack-name stash-production --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)`, then run `npm run aws:smoke` and `npm run cloud:evidence`.

Expected: health, workspace creation, CockroachDB persistence, Bedrock evaluation, S3 evidence, EventBridge dispatch, CloudWatch logs, and X-Ray traces are verified with redacted identifiers.

- [ ] **Step 6: Save redacted evidence**

Write service names, regions, ARNs with account identifiers masked, timestamps, request IDs, index names, stack status, and smoke outcomes to `docs/evidence/stash-production.json`. Include no tokens, connection strings, secret values, email addresses, or account IDs.

- [ ] **Step 7: Commit**

```bash
git add docs/evidence/stash-production.json scripts/cloud-evidence.ts scripts/aws-smoke.ts
git commit -m "docs: add verified Stash cloud evidence"
```

---

### Task 12: Vercel Production Deployment and Repository Cutover

**Files:**
- Create: `vercel.json`
- Create: `.vercelignore`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/submission.md`
- Modify: `infra/parameters.example.json`

**Interfaces:**
- Consumes: AWS API URL, bootstrap key, session secret, verified build, Vercel `stash` project, and GitHub destination repository.
- Produces: `https://trystash.xyz`, public source at `danielAsaboro/stash-cockcroachdb`, and passing CI.

- [ ] **Step 1: Link the local project to the existing Vercel project**

Run: `vercel link --yes --scope harmonia-b4a76411 --project stash`

Expected: `.vercel/project.json` references project `prj_NwSJJHAWKTxb9CYkIEkFBv8aVFub` and the Harmonia team.

- [ ] **Step 2: Configure production secrets**

Add `STASH_API_BASE_URL`, `STASH_BOOTSTRAP_KEY`, `STASH_SESSION_SECRET`, and `NEXT_PUBLIC_APP_URL=https://trystash.xyz` to Vercel Production using stdin or the dashboard. Confirm `vercel env ls production --project stash` lists their names without retrieving values.

- [ ] **Step 3: Deploy and verify a preview**

Run: `vercel deploy --project stash`.

Expected: preview status is `Ready`; its `/api/session`, `/overview`, proposal, quarantine, evaluation, promotion, memory search, rollback, and audit journey pass.

- [ ] **Step 4: Promote the verified source to production**

Run: `vercel deploy --prod --project stash`.

Expected: `vercel inspect https://trystash.xyz` reports the new deployment as `Ready` and aliases include `https://trystash.xyz`.

- [ ] **Step 5: Run production smoke and metadata checks**

Run: `PLAYWRIGHT_BASE_URL=https://trystash.xyz npm run test:e2e` and `curl -fsS https://trystash.xyz/overview`.

Expected: the live journey passes, metadata uses Stash, and no `chatgpt.site`, `Memory CI`, `Sandbox fixture`, or fixed legacy demo IDs appear.

- [ ] **Step 6: Update documentation**

Describe the real onboarding path, AWS/CockroachDB/Vercel architecture, exact production URL, verified evidence, local setup, deployment, and fail-closed behavior. Remove the old ChatGPT Sites URL and demo-only instructions.

- [ ] **Step 7: Verify and change the Git remote**

Run: `git ls-remote https://github.com/danielAsaboro/stash-cockcroachdb.git`, then set `origin` to that exact URL only after the destination resolves.

```bash
git remote set-url origin https://github.com/danielAsaboro/stash-cockcroachdb.git
git remote -v
```

Expected: both fetch and push URLs are the renamed repository.

- [ ] **Step 8: Push and verify CI**

Run: `git push -u origin main`, then inspect the resulting GitHub Actions run.

Expected: the public repository shows the Stash name, MIT license, `trystash.xyz` homepage, and a green release gate.

- [ ] **Step 9: Commit any final evidence-only documentation changes**

```bash
git add README.md docs infra/parameters.example.json vercel.json .vercelignore .gitignore
git commit -m "docs: publish Stash production handoff"
git push origin main
```

---

### Task 13: Final Production Audit and Submission Evidence

**Files:**
- Modify: `docs/submission.md`
- Modify: `submission/script.md` if present
- Modify: `README.md`

**Interfaces:**
- Consumes: Live URLs, CI run, AWS/CockroachDB evidence, and production browser results.
- Produces: A truthful, judge-ready evidence matrix for Stash.

- [ ] **Step 1: Run the complete verification matrix**

Run: `npm run verify && npm run test:e2e && npm run infra:validate && npm run infra:build && npm run production:audit && npm run vector:evidence && npm run cloud:evidence`.

Expected: every required check passes; credential-dependent proof refers to the deployed resources.

- [ ] **Step 2: Audit every sponsor requirement**

Confirm the public repository, MIT license, functional `trystash.xyz` app, under-three-minute public video, two qualifying CockroachDB tools, AWS deployment, AWS service descriptions, setup instructions, architecture, and verified evidence. Mark a requirement complete only when its public artifact resolves.

- [ ] **Step 3: Update the public story**

Use the one-liner: `Stash is the release control plane that lets teams test, approve, promote, and roll back AI-agent memory like code.` Explain the persistent workspace and show actual CockroachDB revisions, vector search, Bedrock evaluation, S3 evidence, EventBridge delivery, and rollback lineage.

- [ ] **Step 4: Verify repository and production one last time**

Run: `git status --short`, inspect the latest GitHub Actions result, and request `https://trystash.xyz/overview`, `/changes`, `/memory`, `/evaluations`, `/agents`, and `/audit`.

Expected: clean working tree, green CI, HTTP success on every route, and no unverified public claim.

- [ ] **Step 5: Commit and push the final evidence update**

```bash
git add README.md docs/submission.md submission/script.md
git commit -m "docs: finalize Stash submission evidence"
git push origin main
```
