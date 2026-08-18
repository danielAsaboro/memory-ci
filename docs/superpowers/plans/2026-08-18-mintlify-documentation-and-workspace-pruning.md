# Mintlify Documentation and Workspace Pruning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a code-grounded Mintlify documentation site for Stash and leave the workspace with only the active repository and assets required to develop, deploy, verify, and submit it.

**Architecture:** `docs/docs.json` defines a four-mode documentation system: tutorials, how-to guides, explanations, and factual reference. Pages derive claims from source contracts, migrations, infrastructure, tests, and production evidence. Cleanup happens only after validation, with inactive parent directories moved to Trash and reproducible ignored output deleted from exact paths.

**Tech Stack:** Mintlify `docs.json`, MDX, Next.js 16, TypeScript, CockroachDB, Drizzle ORM, AWS SAM, npm, Git.

**Spec:** `docs/superpowers/specs/2026-08-18-mintlify-documentation-and-workspace-pruning-design.md`

## Global Constraints

- Work directly on the existing `main` branch; do not create branches or worktrees.
- Treat executable code, migration SQL, infrastructure, tests, and redacted production evidence as sources of truth.
- Preserve `.git`, `.env.local`, `.vercel`, `node_modules`, application source, production evidence, and the requested video script/image kit.
- Do not create or render a video.
- Move material inactive parent-workspace directories to macOS Trash for recovery.
- Delete only exact ignored generated-output paths inside the active repository.
- Use `docs.json`; do not create deprecated `mint.json`.

---

### Task 1: Mintlify shell and brand assets

**Files:**
- Create: `docs/docs.json`
- Create: `docs/.mintignore`
- Create: `docs/images/favicon.svg`
- Create: `docs/images/stash-lineage-hero.jpg`
- Modify: `package.json`

**Interfaces:**
- Consumes: `public/favicon.svg`, `public/stash-lineage-hero.jpg`, live URL `https://trystash.xyz`, and GitHub URL `https://github.com/danielAsaboro/stash-cockcroachdb`.
- Produces: Mintlify navigation paths and `npm run docs:dev`, `npm run docs:validate`, and `npm run docs:links` commands used by later tasks.

- [ ] **Step 1: Add the current Mintlify configuration**

Create `docs/docs.json` with schema `https://mintlify.com/docs.json`, theme `mint`, Stash primary color `#e24b72`, dark color `#100d10`, light color `#fff9f7`, logo text fallback, favicon `/images/favicon.svg`, navbar links to the application and GitHub, and navigation groups for Get started, Understand Stash, Guides, Reference, and Evidence. Every path must correspond to a page created in Tasks 2–4.

- [ ] **Step 2: Freeze brand assets inside the docs root**

Copy the existing favicon and lineage hero into `docs/images/` without regenerating or restyling them. Add alt text wherever the hero is embedded.

- [ ] **Step 3: Exclude non-public retained assets**

Create `docs/.mintignore` containing `video-kit/**`, `audits/**`, and `superpowers/**` so retained implementation/submission material cannot become a Mintlify page.

- [ ] **Step 4: Add repeatable docs commands**

Add these scripts to the root `package.json`:

```json
"docs:dev": "cd docs && npx mint dev --no-open",
"docs:validate": "cd docs && npx mint validate",
"docs:links": "cd docs && npx mint broken-links --check-anchors"
```

- [ ] **Step 5: Check configuration syntax**

Run `node -e 'JSON.parse(require("fs").readFileSync("docs/docs.json","utf8")); console.log("docs.json valid JSON")'` and expect `docs.json valid JSON`.

### Task 2: Getting-started tutorials and conceptual explanations

**Files:**
- Create: `docs/index.mdx`
- Create: `docs/quickstart.mdx`
- Create: `docs/tutorials/first-release.mdx`
- Create: `docs/concepts/architecture.mdx`
- Create: `docs/concepts/release-lifecycle.mdx`
- Create: `docs/concepts/why-cockroachdb.mdx`
- Create: `docs/concepts/security-model.mdx`

**Interfaces:**
- Consumes: routes from `src/api/router.ts`, transitions from `src/domain/lifecycle.ts`, migrations from `db/migrations/`, services from `src/services/`, infrastructure from `infra/template.yaml`, and local commands from `package.json`.
- Produces: onboarding and mental-model pages linked from guides and reference.

- [ ] **Step 1: Write the documentation home**

State the product outcome in one paragraph, provide cards for the local quickstart, first release, architecture, and HTTP reference, link to the live product, and clearly label Stash as release control for durable AI-agent memory rather than a general vector database UI.

- [ ] **Step 2: Write one reliable local quickstart**

Require Node.js 22.13+, Docker, and npm. Use `cp .env.example .env.local`, `npm ci`, `docker compose up -d`, `npm run demo:reset`, and `npm run dev`. Provide expected results and direct the reader to `/onboarding`. Warn that production secrets must never be copied into client-visible variables.

- [ ] **Step 3: Write the first-release tutorial**

Guide one memory through propose, screen, evaluate, approve, promote, retrieve, and forward-only rollback. Keep architecture discussion out of the steps and link to concept pages instead.

- [ ] **Step 4: Explain architecture and trust boundaries**

Describe the Vercel same-origin session gateway, AWS API/Lambda/outbox/sandbox plane, CockroachDB system of record, Bedrock judgment and embeddings, S3 evidence, and EventBridge delivery. Explicitly distinguish synchronous lifecycle receipts from asynchronous evidence work.

- [ ] **Step 5: Explain lifecycle, CockroachDB depth, and security**

Represent only transitions present in `src/domain/lifecycle.ts`. Explain serializable promotion/rollback, active-version uniqueness, vector retrieval, tenant-scoped records, immutable lineage, reviewer roles, Ed25519 elevated provenance, fail-closed evaluation, idempotency keys, and request IDs with links to exact reference pages.

- [ ] **Step 6: Scan for unsupported claims**

Run `rg -n "guarantee|best|first prize|unhackable|perfect|zero risk" docs -g '*.mdx'` and expect no matches.

### Task 3: Operational guides and factual reference

**Files:**
- Create: `docs/guides/review-change.mdx`
- Create: `docs/guides/rollback-lineage.mdx`
- Create: `docs/guides/inspect-audit.mdx`
- Create: `docs/guides/deploy-production.mdx`
- Create: `docs/reference/http-api.mdx`
- Create: `docs/reference/configuration.mdx`
- Create: `docs/reference/lifecycle-states.mdx`
- Create: `docs/reference/commands.mdx`
- Create: `docs/reference/repository-map.mdx`

**Interfaces:**
- Consumes: Task 2 concept paths; schemas in `src/contracts/`; router behavior in `src/api/router.ts`; environment readers in `src/aws/config.ts`, session code, deployment scripts, `.env.example`, and `infra/template.yaml`.
- Produces: executable operator guidance and lookup-oriented system facts.

- [ ] **Step 1: Write four outcome-focused how-to guides**

Each guide begins with prerequisites, gives an executable sequence, includes a completion check, and stops at the stated task. Link rationale to concepts and exhaustive values to reference.

- [ ] **Step 2: Document the HTTP surface**

List all 19 router entries by method and `/v1` path. State bearer authentication, tenant membership, reviewer/admin requirements for lifecycle mutations, `Idempotency-Key` requirements, `x-request-id` behavior, strict JSON validation, and the `202` responses declared by the router. Do not invent rate limits or response fields absent from contracts.

- [ ] **Step 3: Document configuration without secrets**

For every `.env.example` variable, state scope, purpose, and whether it is server-only or browser-visible. Document `TEST_DATABASE_URL` and `TEST_DATABASE_ADMIN_URL` only where tests actually read them. Never include a real secret or production database URL.

- [ ] **Step 4: Document exact lifecycle states and commands**

List the 12 candidate states and valid event transitions from the transition table. List every root package command by category using its current script value and a concise purpose.

- [ ] **Step 5: Document the maintained repository map**

Describe `app/`, `src/domain/`, `src/services/`, `src/db/`, `db/migrations/`, `src/aws/`, `src/lambda/`, `infra/`, `scripts/`, `tests/e2e/`, `public/`, and `docs/` without mentioning paths scheduled for deletion.

- [ ] **Step 6: Check endpoint coverage**

Run `rg -o 'method: "(GET|POST)"' src/api/router.ts | wc -l` and verify the result is `19`; then compare the 19 documented method/path headings against the route array.

### Task 4: Production evidence and restrained differentiation

**Files:**
- Create: `docs/evidence/production.mdx`
- Create: `docs/evidence/competitive-differentiation.mdx`
- Preserve: `docs/evidence/stash-production.json`

**Interfaces:**
- Consumes: `docs/evidence/stash-production.json`, evidence scripts under `scripts/`, production audit tests, and code-backed architecture from Tasks 2–3.
- Produces: evaluator-facing proof pages that distinguish observed evidence from architectural assertions.

- [ ] **Step 1: Document the production evidence boundary**

Explain each proof category present in the redacted receipt, link to the raw JSON, state its generation timestamp, and distinguish a point-in-time observation from continuous availability or security certification.

- [ ] **Step 2: Document competitive differentiation**

Compare Stash's implemented release-control loop against direct memory writes and ordinary retrieval-only systems. Anchor differentiation in provenance, screening, replay evidence, evidence-bound review, atomic promotion, agent-visible revisions, immutable audit lineage, and rollback. Do not claim guaranteed prize placement.

- [ ] **Step 3: Verify evidence references**

Use a Node one-liner to parse `docs/evidence/stash-production.json`; verify every named evidence field in the MDX exists in the JSON or is explicitly labeled an architectural claim sourced from code.

### Task 5: Mintlify and repository verification

**Files:**
- Modify only files required to correct validation failures.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a validated docs site and a verified application baseline before cleanup.

- [ ] **Step 1: Validate Mintlify**

Run `npm run docs:validate`. Expected: exit code `0` with no configuration or MDX errors.

- [ ] **Step 2: Check links and anchors**

Run `npm run docs:links`. Expected: exit code `0` with no broken internal links or anchors.

- [ ] **Step 3: Preview representative pages**

Run `npm run docs:dev -- --port 3333`, inspect `/`, `/quickstart`, `/concepts/architecture`, and `/reference/http-api`, then stop the server. Verify brand consistency, readable navigation, and no MDX runtime error.

- [ ] **Step 4: Verify the application before cleanup**

Run `npm run verify` and `npm run test:e2e`. Expected: unit, integration, lint, typecheck, build, desktop, mobile, and accessibility checks pass with only the intentional desktop mobile-navigation skip.

- [ ] **Step 5: Commit the validated docs**

Commit the Mintlify configuration, pages, assets, and package scripts with `docs: add verified Mintlify product documentation` on `main`.

### Task 6: Recoverable workspace pruning

**Files:**
- Delete tracked superseded docs listed in the approved spec.
- Delete exact ignored generated-output paths listed below.
- Move exact inactive parent paths into `/Users/MAC/.Trash/stash-workspace-prune-2026-08-18/`.

**Interfaces:**
- Consumes: successful Task 5 verification.
- Produces: one active workspace with no stale checkout or reproducible output.

- [ ] **Step 1: Reprint exact targets and confirm active state**

Run `pwd`, `git branch --show-current`, `git worktree list --porcelain`, `git status --short`, and `du -sh` over every target. Proceed only from `/Users/MAC/development/wip/cockroachdb-ai/stash-cockdb` on `main` with one registered worktree.

- [ ] **Step 2: Move inactive parent material to Trash**

Create `/Users/MAC/.Trash/stash-workspace-prune-2026-08-18/` and move only these exact siblings: `.mithridate`, `videos`, parent `docs`, `resources`, `skill-work`, `submission`, `urls.md`, and parent `.DS_Store`.

- [ ] **Step 3: Delete reproducible ignored output**

Remove only these exact active-repository paths: `.next`, `.aws-sam`, `.sam-cli`, `.vinext`, `.wrangler`, `coverage`, `dist`, `playwright-report`, `test-results`, `tsconfig.tsbuildinfo`, `.DS_Store`, `docs/.DS_Store`, `.superpowers`, and empty `.worktrees`.

- [ ] **Step 4: Remove superseded tracked documents**

Delete `docs/architecture.md`, `docs/submission.md`, `docs/demo-video.md`, `docs/audits/`, and `docs/superpowers/` after confirming their implementation-backed information exists in the new site. Preserve `docs/video-kit/` and `docs/evidence/stash-production.json`.

- [ ] **Step 5: Confirm the final workspace**

Run `find /Users/MAC/development/wip/cockroachdb-ai -mindepth 1 -maxdepth 1 -print`, `git worktree list --porcelain`, `git status --short`, `git diff --check`, and existence checks for `.env.local`, `.vercel`, `node_modules`, `docs/video-kit`, and `docs/evidence/stash-production.json`. Expect the parent workspace to contain only `stash-cockdb` and Git to report only intentional tracked documentation deletions.

- [ ] **Step 6: Commit and push main**

Commit cleanup with `chore: prune stale workspace documentation` and push `main`. Confirm the GitHub Actions run passes before reporting completion.
