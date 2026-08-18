# Stash Devpost Prize Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the verified Stash backend and live AWS/CockroachDB deployment into an undeniable, reproducible, rule-complete Devpost submission before the deadline.

**Architecture:** Treat public commit `b231ecf` as the only implementation baseline. Preserve the old local landing work as a patch, then port only its useful visual ideas onto the live Next.js workspace console. Keep CockroachDB/AWS behavior unchanged except where judge reproducibility or production safety requires a narrow extension.

**Tech Stack:** Next.js 16, React 19, TypeScript, CockroachDB 26.2, pg, AWS SAM/Lambda/Bedrock/S3/EventBridge/CloudWatch/X-Ray, Vercel, Vitest, Playwright.

**Spec:** `docs/audits/2026-08-18-devpost-critical-evaluation.md`

**Competitive analysis:** `docs/audits/2026-08-18-competitive-analysis.md`

## Competitive Priority Override

- [ ] Show one named agent performing semantic retrieval, acting on the returned active revision, and persisting a read receipt.
- [ ] Make the poison-versus-safe consequence understandable from the first live workflow, not only from architecture prose.
- [ ] Put Distributed Vector Indexing and the second qualifying CockroachDB tool in a judge-readable evidence view.
- [ ] Re-check the public Devpost gallery when it is published and update the threat matrix before final submission.

## Global Constraints

- Submission deadline: 2026-08-18 5:00 PM EDT / 10:00 PM WAT.
- The public repository, demo, and video must remain freely accessible through 2026-09-15 5:00 PM EDT.
- The project must meaningfully use at least two qualifying CockroachDB tools and at least one AWS service.
- Never commit credentials, connection strings, raw account IDs, email addresses, bearer tokens, or unredacted customer content.
- Do not weaken serializable transactions, idempotency, signature verification, tenant isolation, append-only audit controls, or fail-closed evaluation behavior.
- Do not replace production evidence with local fixtures.

---

### Task 1: Establish One Safe Source of Truth

**Files:**
- Preserve: `app/page.tsx`, `app/globals.css`, `app/layout.tsx`, `app/components/release-showcase.tsx`, `tests/e2e/landing.spec.ts` from the dirty local checkout as a patch only
- Base all implementation on: public `main` at or after `b231ecf`
- Create: `docs/evidence/release-baseline.md`

**Interfaces:**
- Consumes: dirty local landing work and public main.
- Produces: one current branch whose backend, tests, docs, and deployment match.

- [ ] **Step 1: Record the two baselines without changing either**

Run:

```bash
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...b231ecfc8f46ef5bf1d62c92705d9e65ccf6cc8a
git diff -- app/page.tsx app/globals.css app/layout.tsx app/components/app-shell.tsx package.json tests/e2e/accessibility.spec.ts
```

Expected: local HEAD is `5445483`; public commit is 64 commits ahead; the dirty files are still present.

- [ ] **Step 2: Save the landing work as a recoverable patch**

Run:

```bash
git diff --binary > /tmp/stash-local-landing.patch
```

Copy untracked `app/components/release-showcase.tsx` and `tests/e2e/landing.spec.ts` into a temporary review directory. Do not apply this patch wholesale to public main.

- [ ] **Step 3: Start from public main in an isolated worktree**

Use `superpowers:using-git-worktrees`. Verify the new worktree resolves `b231ecf` or a direct descendant and has no uncommitted files.

- [ ] **Step 4: Write the release baseline record**

Create `docs/evidence/release-baseline.md` with these exact facts: public commit SHA, deployment URL, GitHub Actions run URL, evidence receipt timestamp, video URL, and Devpost submission URL. Do not include secrets or private evidence paths.

- [ ] **Step 5: Run the baseline gate**

Run:

```bash
npm ci
npm run verify
npm run test:e2e
npm run infra:validate
npm run infra:build
npm run production:audit
```

Expected: every command exits `0`; 267 unit tests, 31 integration tests, and 29 browser tests remain at least as strong as the audited public commit.

---

### Task 2: Remove the Judge Reproducibility Trap

**Files:**
- Modify: `src/contracts/workspace.ts`
- Modify: `src/db/workspaces.ts`
- Modify: `src/services/bootstrap-workspace.ts`
- Modify: `app/api/session/route.ts`
- Modify: `app/components/propose-memory-dialog.tsx`
- Modify: `app/changes/page.tsx`
- Test: `app/api/session/route.test.ts`
- Test: `app/components/propose-memory-dialog.test.tsx`
- Test: `tests/e2e/poison-and-promote.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceBootstrap.namespaceId` already returned by the AWS service.
- Produces: `WorkspaceMetadata.namespaceId: string` and a proposal dialog prefilled with the active namespace.

- [ ] **Step 1: Write the failing workspace-contract test**

Add an assertion that session bootstrap returns this exact public shape:

```ts
expect(await response.json()).toMatchObject({
  tenantId: expect.any(String),
  principalId: expect.any(String),
  namespaceId: expect.any(String),
  workspaceName: expect.any(String),
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- app/api/session/route.test.ts`

Expected: FAIL because `namespaceId` is currently projected out.

- [ ] **Step 3: Extend the public workspace contract**

Add `namespaceId: identifierSchema` to `workspaceBootstrapSchema` and `WorkspaceMetadata`. Preserve the field in `projectWorkspaceBootstrap()` and `workspaceMetadata()`.

- [ ] **Step 4: Prefill the proposal dialog**

Change the component boundary to:

```ts
export function ProposeMemoryDialog({
  workspaceId,
  namespaceId,
  onClose,
}: {
  workspaceId: string;
  namespaceId: string;
  onClose: () => void;
})
```

Initialize the form with `namespaceId` and render it as read-only context rather than requiring a judge to paste a UUID.

- [ ] **Step 5: Prove a new visitor can propose without hidden identifiers**

Update Playwright to open `/changes`, click `Propose memory`, assert the namespace is already present, and submit without reading database internals or deriving UUIDs.

- [ ] **Step 6: Run focused and lifecycle tests**

Run:

```bash
npm test -- app/api/session/route.test.ts app/components/propose-memory-dialog.test.tsx
npm run test:e2e -- tests/e2e/poison-and-promote.spec.ts
```

Expected: all pass on desktop and mobile.

---

### Task 3: Put Real Semantic Retrieval in the Visible Product

**Files:**
- Modify: `app/lib/api-client.ts`
- Modify: `app/components/memory-explorer.tsx`
- Modify: `app/memory/page.tsx`
- Modify: `src/contracts/dashboard.ts`
- Test: `app/memory/memory-explorer.test.tsx`
- Test: `tests/e2e/poison-and-promote.spec.ts`

**Interfaces:**
- Consumes: existing `POST /v1/memory/search` with `{ namespaceId, query, purpose, revision? }`.
- Produces: visible semantic search results with revision and a persisted read receipt.

- [ ] **Step 1: Write a failing API-client test**

Add:

```ts
await searchMemory({
  namespaceId: ids.namespace,
  query: "Which rule controls refund review?",
  purpose: "judge-demo",
});
expect(fetch).toHaveBeenCalledWith(
  "/api/stash/v1/memory/search",
  expect.objectContaining({ method: "POST" }),
);
```

- [ ] **Step 2: Add the typed client method**

Implement `searchMemory(input)` through `stashMutation` and validate the existing projected search response. Do not expose `canonicalPayload` through the gateway.

- [ ] **Step 3: Separate local filter from semantic search**

Keep a small "Filter loaded rows" control if useful. Add a distinct form labeled `Semantic memory query`, a submit button, loading/error states, and result rows showing stable key, class, revision, and distance/rank if the API exposes it.

- [ ] **Step 4: Show the read receipt consequence**

After a successful semantic query, invalidate `queryKeys.agents(workspaceId)` and `queryKeys.memories(workspaceId)`. The Agents page must increment reads for the registered agent or the API must explicitly attribute the query to the human judge; do not pretend a browser user is an agent.

- [ ] **Step 5: Add a real E2E assertion**

After promotion, submit the semantic query, assert the promoted generated memory ID is returned, navigate to Agents or Audit, and assert the corresponding read receipt exists.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- app/memory/memory-explorer.test.tsx app/lib/api-client.test.ts
npm run test:e2e -- tests/e2e/poison-and-promote.spec.ts
```

Expected: the browser test proves a CockroachDB vector query, not substring filtering.

---

### Task 4: Make Provider Evidence Judge-Visible

**Files:**
- Modify: `src/contracts/dashboard.ts`
- Modify: `src/services/read-workspace.ts`
- Modify: `app/components/evaluation-matrix.tsx`
- Modify: `app/audit/page.tsx`
- Modify: `app/onboarding/page.tsx`
- Test: `app/components/live-pages.test.tsx`
- Test: `tests/e2e/poison-and-promote.spec.ts`

**Interfaces:**
- Consumes: evaluation `providerRequestId`, `artifactUri`, model ID, trigger event ID, policy version, and public redacted production receipt.
- Produces: one evidence drawer that visibly connects Bedrock, S3, EventBridge, CockroachDB revision, and vector-index proof.

- [ ] **Step 1: Write a failing evidence rendering test**

Given a completed evaluation, assert the page displays:

```text
Bedrock request: <providerRequestId>
Evidence artifact: verified
Baseline revision: r1
Policy: <policyVersion>
```

Do not expose a private S3 URL or bucket key.

- [ ] **Step 2: Project safe evidence fields through the gateway**

Add only bounded, non-secret fields. Convert `artifactUri` to a boolean `artifactVerified` or a safe content digest unless the URL is explicitly public and credential-free.

- [ ] **Step 3: Add the CockroachDB proof card**

Read a build-time sanitized summary derived from `docs/evidence/stash-production.json`: `VECTOR(1024)`, index name, job status, EXPLAIN index name, Cockroach tier, AWS region, and capture time. Do not load the entire evidence receipt into client JavaScript.

- [ ] **Step 4: Correct readiness language**

Replace "ready" based only on environment variables with `configured` unless a bounded live probe succeeds. Render the last verified evidence time separately.

- [ ] **Step 5: Prove the live story in E2E**

Assert that a completed run exposes a provider request ID and verified artifact state, while a Bedrock timeout displays `Inconclusive` and never displays verified evidence.

- [ ] **Step 6: Run tests and production audit**

Run:

```bash
npm test -- app/components/live-pages.test.tsx
npm run test:e2e -- tests/e2e/poison-and-promote.spec.ts
npm run production:audit
```

---

### Task 5: Make the Two CockroachDB Tools Undeniable

**Files:**
- Modify: `docs/submission.md`
- Modify: `docs/demo-video.md`
- Modify: `docs/evidence/README.md`
- Create: `scripts/public-evidence.test.ts`
- Create: `scripts/public-evidence.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: redacted `docs/evidence/stash-production.json`.
- Produces: `npm run evidence:verify-public`, an explicit Vector Indexing proof, and an explicit `ccloud`/Agent Skills proof.

- [ ] **Step 1: Write a failing public-evidence test**

The validator must accept redacted account placeholders while still requiring:

```ts
{
  verified: true,
  region: "us-east-1",
  smoke: { kind: "aws-smoke" },
  vector: { kind: "vector", vector: { ready: true, explainIndexName: "memory_versions_active_embedding_idx" } },
  ccloud: { kind: "ccloud", ccloud: { provider: "AWS", region: "us-east-1" } },
}
```

It must reject missing provider requests, a non-succeeded vector job, mismatched regions, fixture hosts, or secret-shaped values.

- [ ] **Step 2: Implement the separate redacted schema**

Do not weaken `receiptSchema`, which validates raw correlated receipts. Add `publicEvidenceSchema` specifically for the post-redaction artifact.

- [ ] **Step 3: Add the command**

Add:

```json
"evidence:verify-public": "tsx scripts/public-evidence.ts docs/evidence/stash-production.json"
```

- [ ] **Step 4: Rewrite the tool claim precisely**

Use this hierarchy in submission copy:

1. Distributed Vector Indexing is a runtime application dependency.
2. `ccloud` CLI is an authenticated production-operations/evidence dependency tied to the same cluster and run.
3. Agent Skills produced concrete transaction, privilege, audit, and index changes; list the exact migration/test for each.
4. Managed MCP is prepared for a read-only auditor but is not claimed as executed unless an actual sanitized capture exists.

- [ ] **Step 5: Put both tools in the first two minutes of the video**

Show the live semantic query using the distributed index, then show the sanitized `ccloud` JSON fields for provider, region, tier, and state. Do not make judges infer tool usage from architecture prose.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- scripts/public-evidence.test.ts
npm run evidence:verify-public
```

Expected: both exit `0` on the committed redacted receipt.

---

### Task 6: Port the Landing Story onto the Real Application

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `app/components/app-shell.tsx`
- Create or port: `app/components/release-showcase.tsx`
- Test: `tests/e2e/landing.spec.ts`
- Test: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- Consumes: visual ideas from `/tmp/stash-local-landing.patch` and live workspace APIs from public main.
- Produces: a public first viewport that explains the novel idea before opening the console.

- [ ] **Step 1: Write the landing E2E test against public main**

Assert the root page contains these exact concepts: `Release control for AI memory`, `Poisoning checks`, `Behavioral evaluation`, `Atomic promotion`, and a primary link to `/overview`.

- [ ] **Step 2: Verify it fails on the current redirect**

Run: `npm run test:e2e -- tests/e2e/landing.spec.ts`

Expected: FAIL because `/` redirects directly to `/overview`.

- [ ] **Step 3: Port only presentation code**

Do not bring back `demo-data.ts`, fixture metrics, or the old `getIntegrationStatus()` fallback. The landing page may use static explanatory copy, but any runtime status must come from the live workspace boundary or be labeled as a recent verified evidence timestamp.

- [ ] **Step 4: Make claims match proof**

Replace absolute marketing claims such as `100% traceable releases` and `0 silent writes` unless measured. Prefer `Every promoted revision is bound to review and evidence` and `Unscreened candidates are excluded from active retrieval`.

- [ ] **Step 5: Validate desktop, mobile, metadata, and accessibility**

Run:

```bash
npm run test:e2e -- tests/e2e/landing.spec.ts tests/e2e/accessibility.spec.ts
npm run build
```

Expected: root stays public, the console remains functional, and WCAG A/AA checks pass.

---

### Task 7: Close Production-Readiness Claims Gaps

**Files:**
- Modify: `infra/template.yaml`
- Modify: `src/services/read-workspace.ts`
- Modify: `src/services/bootstrap-workspace.ts`
- Create: `src/lambda/workspace-cleanup.ts`
- Create: `src/services/cleanup-workspaces.ts`
- Test: `infra/template.test.ts`
- Test: `src/services/bootstrap-workspace.integration.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/submission.md`

**Interfaces:**
- Consumes: anonymous demo workspace creation and AWS/CockroachDB provider state.
- Produces: bounded demo cost, explicit retention, honest readiness, and accurate identity claims.

- [ ] **Step 1: Add failing quota/expiry tests**

Test that a workspace bootstrap records `expiresAt`, rejects creation above a configured per-IP or global demo budget, and never expires a workspace during the judging period unless a new session can be created safely.

- [ ] **Step 2: Add bounded cleanup**

Create a scheduled Lambda that deletes expired demo tenants in small batches using tenant-scoped foreign-key-safe deletion. Production customer workspaces must not use this path.

- [ ] **Step 3: Add cost and backlog alarms**

Add AWS Budget documentation plus CloudWatch alarms for Lambda throttles, outbox oldest age, Bedrock failures/timeouts, and workspace-creation rate. The existing `OutboxAgeAlarm` measures function errors, not queue age; rename or implement the actual age metric.

- [ ] **Step 4: Make readiness probe real or label it configured**

For Bedrock, S3, and EventBridge, either perform bounded health checks with caching or render `configured` and show last verified production evidence time. Never equate environment-variable presence with service health.

- [ ] **Step 5: Remove or accurately scope Cognito claims**

If Cognito does not authorize the public console, describe it only as retained infrastructure or remove it. Do not list it as protection for anonymous workspace sessions.

- [ ] **Step 6: Document the actual resilience envelope**

State that the audited CockroachDB cluster is BASIC, AWS `us-east-1`, and single-region unless that changes. Explain which design elements are region-portable without claiming tested global failover.

- [ ] **Step 7: Verify**

Run:

```bash
npm test -- infra/template.test.ts
npm run test:integration -- src/services/bootstrap-workspace.integration.test.ts
npm run infra:validate
npm run infra:build
```

---

### Task 8: Prepare the Video Production Kit and Devpost Submission

**Files:**
- Modify: `docs/demo-video.md`
- Create: `docs/video-kit/README.md`
- Create: `docs/video-kit/stash-devpost-script.md`
- Create: `docs/video-kit/shot-list.md`
- Create: `docs/video-kit/captions.vtt`
- Create: `docs/video-kit/captures/*.jpg`
- Modify: `docs/submission.md`
- Modify: `README.md`
- Modify: `docs/evidence/release-baseline.md`
- User-owned external artifact: public YouTube or Vimeo video under 3:00
- External artifact: Devpost submission

**Interfaces:**
- Consumes: verified live demo, two CockroachDB tool proofs, AWS evidence, public repository.
- Produces: a recording-ready production kit and a rule-complete Devpost entry once the user supplies the public video URL.

**Hard boundary:** Codex must not assemble, render, upload, or publish the video. It may create the script, captions, still captures, callout graphics, recording checklist, and link-validation checklist. The user owns recording, editing, upload, and publication.

- [ ] **Step 1: Rewrite the video around what a judge can verify**

Use this timed structure:

```text
0:00–0:15  Problem and one-line differentiation
0:15–0:40  Live poison proposal → two findings → quarantine
0:40–1:20  Safe proposal → Bedrock provider receipt → approval
1:20–1:45  Atomic promotion → revision changes in CockroachDB
1:45–2:10  Semantic vector query → returned memory → read receipt
2:10–2:28  ccloud sanitized cluster proof + AWS evidence summary
2:28–2:48  Forward rollback + immutable audit chain
2:48–2:55  Close and URL
```

Do not claim two agents, Cognito browser auth, global failover, or zero-loss scale unless the footage proves it.

- [ ] **Step 2: Create every pre-production asset**

Create the canonical production script, shot list, captions, sanitized live-site captures, callout copy, thumbnail source, recording settings, and final export checklist under `docs/video-kit/`.

Expected: another person can record and edit the demo without making product or technical decisions.

- [ ] **Step 3: Hand the production kit to the user**

The user records, edits, uploads, and publishes the video. After the user supplies the URL, verify it in a logged-out browser. Do not upload or publish on the user's behalf.

- [ ] **Step 4: Update every public pointer**

Add the exact video URL and Devpost project URL to `README.md`, `docs/submission.md`, and `docs/evidence/release-baseline.md`. Remove future-tense text such as `link added at submission time`.

- [ ] **Step 5: Complete Devpost fields**

Verify the submission contains:

```text
Public repository: https://github.com/danielAsaboro/stash-cockcroachdb
Functional demo: https://trystash.xyz
Video: <public YouTube/Vimeo URL>
CockroachDB tools: Distributed Vector Indexing + ccloud CLI + Agent Skills
AWS services: Bedrock + Lambda/API Gateway + S3 + EventBridge
```

- [ ] **Step 6: Test every link as a logged-out judge**

Run:

```bash
curl -fsSIL https://trystash.xyz/overview
git ls-remote https://github.com/danielAsaboro/stash-cockcroachdb.git HEAD
```

Open the Devpost and video URLs logged out. Expected: no credentials, access request, 404, private video, or redirect to an obsolete `chatgpt.site` demo.

- [ ] **Step 7: Submit before 10:00 PM WAT and capture proof**

Save the Devpost confirmation URL and timestamp in `docs/evidence/release-baseline.md`. Do not wait until the final minute; Devpost states that no substantive changes are allowed after the submission period.

---

### Task 9: Run the Final Prize Gate and Freeze the Entry

**Files:**
- Modify only if a gate fails: the exact failing source/test/document
- Record: `docs/evidence/release-baseline.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a reproducible public submission that remains stable through judging.

- [ ] **Step 1: Run the complete local gate from a clean install**

Run:

```bash
npm ci
npm run verify
npm run test:e2e
npm run infra:validate
npm run infra:build
npm run production:audit
npm run evidence:verify-public
npm audit --omit=dev --audit-level=high
```

Expected: every command exits `0`.

- [ ] **Step 2: Run production smoke checks**

Verify `/overview`, `/changes`, `/memory`, `/evaluations`, `/agents`, `/audit`, `/onboarding`, and `/settings` settle from loading to live data with no console errors. Run one poison quarantine and one safe evaluation/promotion in a new isolated workspace.

- [ ] **Step 3: Verify GitHub release state**

Confirm public main equals the submitted commit, GitHub Actions is green, MIT is detected, the homepage is `https://trystash.xyz`, and the repository contains `docs/evidence/stash-production.json` plus the final video link.

- [ ] **Step 4: Verify the submission against every official rule**

Use the eligibility table in `docs/audits/2026-08-18-devpost-critical-evaluation.md`. Mark a row complete only from a public, logged-out artifact.

- [ ] **Step 5: Freeze and monitor**

Keep the demo, repository, and video online through 2026-09-15 5:00 PM EDT. Monitor API errors, outbox backlog, workspace creation, Bedrock failures, CockroachDB capacity, domain/TLS expiry, and the public video. Make no destructive demo resets during judging.

---

## Execution order under the deadline

1. Task 1 — source-of-truth safety.
2. Task 8 — production kit only; the user owns recording and publication, while the public URL remains a hard eligibility gate.
3. Task 2 — namespace prefill; highest judge-reproducibility defect.
4. Task 5 — undeniable two-tool proof.
5. Task 4 — provider evidence visibility.
6. Task 3 — visible semantic retrieval/read receipt.
7. Task 6 — landing story, only after it is ported onto public main.
8. Task 9 — final gate and freeze.
9. Task 7 — production hardening that cannot safely fit before submission continues immediately after submission without changing the judged entry unless rules permit.
