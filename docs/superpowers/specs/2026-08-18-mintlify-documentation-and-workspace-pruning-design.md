# Mintlify documentation and workspace pruning design

## Objective

Turn the existing `docs/` directory into a validated Mintlify site that documents the product as implemented, then remove obsolete repositories, abandoned media workspaces, superseded process notes, and reproducible generated output without damaging the active application or its deployment state.

## Documentation audiences

The site serves three readers without mixing their needs on individual pages:

1. Evaluators who need to understand the product, CockroachDB depth, trust model, and production evidence quickly.
2. Developers who need a reliable local setup and a guided first memory release.
3. Operators and integrators who need task guides, HTTP contracts, configuration facts, lifecycle states, and deployment controls.

## Information architecture

`docs/docs.json` is the Mintlify root and uses the current `docs.json` schema. It applies the Stash warm-black, burgundy, rose, and warm-white identity; links to the live application and GitHub repository; and organizes pages by documentation mode.

### Get started

- `index.mdx`: concise product entry point and navigation cards.
- `quickstart.mdx`: one reliable local path from checkout to an isolated demo workspace.
- `tutorials/first-release.mdx`: propose, screen, evaluate, approve, promote, retrieve, and roll back one memory.

### Understand Stash

- `concepts/architecture.mdx`: runtime components, trust boundaries, and data flow.
- `concepts/release-lifecycle.mdx`: state machine and forward-only release semantics.
- `concepts/why-cockroachdb.mdx`: transactions, tenant isolation, vector retrieval, audit lineage, and the outbox.
- `concepts/security-model.mdx`: identity, provenance, signatures, fail-closed evidence, and reviewer authorization.

### Operate Stash

- focused how-to guides for reviewing a change, rolling back a lineage, inspecting audit evidence, and deploying the production stack.

### Reference

- `reference/http-api.mdx`: routes, authentication, idempotency, request IDs, validation, and status behavior derived from `src/api/router.ts` and its contracts.
- `reference/configuration.mdx`: environment variables and secret boundaries derived from `.env.example`, runtime configuration, and infrastructure parameters.
- `reference/lifecycle-states.mdx`: exact states and valid transitions from `src/domain/lifecycle.ts`.
- `reference/commands.mdx`: current package commands and their purpose.
- `reference/repository-map.mdx`: maintained source layout.

### Evidence

- `evidence/production.mdx`: what the public evidence receipt proves, what it does not prove, and how to regenerate it.
- `evidence/competitive-differentiation.mdx`: implementation-backed differentiation with restrained claims and no prize guarantees.

Tutorials teach one controlled path. How-to guides solve operational tasks. Concept pages explain design decisions. Reference pages state exact facts. Cross-links connect these modes instead of blending them.

## Source-of-truth policy

Claims must be supported by executable code, migration SQL, infrastructure, tests, or the redacted production evidence receipt. Existing Markdown is research material only and cannot establish a fact by itself. Endpoint documentation comes from router schemas and contracts; lifecycle documentation comes from the transition table; configuration comes from runtime readers and infrastructure parameters; CockroachDB behavior comes from repositories, migrations, and tests.

## Mintlify implementation

- Use `docs.json`, not deprecated `mint.json`.
- Use MDX frontmatter on every page.
- Reuse the Stash favicon and generated lineage artwork inside `docs/images/`.
- Use Mintlify cards, steps, callouts, tabs, and diagrams sparingly where they improve scanning.
- Add `.mintignore` for internal evidence payloads or retained submission assets that should not become public pages.
- Add root npm commands for local docs preview, validation, and broken-link checks without coupling the application runtime to Mintlify.

## Pruning policy

### Preserve

- `/Users/MAC/development/wip/cockroachdb-ai/stash-cockdb`, its `main` branch, `.git`, active `node_modules`, `.env.local`, and `.vercel` linkage.
- application source, migrations, infrastructure, tests, production evidence, generated brand assets, and the requested video script/image kit.
- secrets remain ignored and are never copied into documentation.

### Remove from the parent workspace

After confirming that required facts and submission assets exist in the active repository, move these inactive siblings into a dated folder in the macOS Trash:

- `.mithridate/`: clean, standalone, remote-less obsolete prototype checkout (approximately 496 MB).
- `videos/`: abandoned render workspace (approximately 233 MB); no video is part of this scope.
- parent-level `docs/`, `resources/`, `skill-work/`, `submission/`, `urls.md`, and `.DS_Store`: setup-era material superseded by the active repository.

These are not registered worktrees of the active repository. `git worktree list` must still show only the active `stash-cockdb` checkout after cleanup.

### Remove from the active repository

- ignored reproducible output: `.next/`, `.aws-sam/`, `.sam-cli/`, `.vinext/`, `.wrangler/`, `coverage/`, `dist/`, `playwright-report/`, `test-results/`, `tsconfig.tsbuildinfo`, `.DS_Store`, `docs/.DS_Store`, the ignored `.superpowers/` scratch directory, and the empty `.worktrees/` directory.
- tracked superseded process documents after their useful verified content is represented in the Mintlify site: old `docs/superpowers/` plans/specifications, old audit drafts, `docs/architecture.md`, `docs/submission.md`, and `docs/demo-video.md`. This implementation-only design is also removed from the final product tree after the work is verified; its committed history remains available if needed.

The existing `docs/video-kit/` content remains because the user explicitly requested the script, images, captions, and shot list needed by a future editor. It will be excluded from Mintlify navigation and public indexing.

## Safety and recovery

Material parent-workspace directories are moved to Trash, not recursively erased. Generated ignored output can be deleted because it is reproducible. Before cleanup, print and verify every exact target. Never target the workspace root, the active repository root, `.git`, `.env.local`, `.vercel`, or `node_modules`.

## Verification

1. Validate `docs/docs.json` against Mintlify.
2. Run Mintlify broken-link and anchor checks.
3. Preview the docs locally and inspect the entry page and representative tutorial, concept, and reference pages.
4. Run repository lint, typecheck, unit tests, integration tests, and production build before deleting generated output.
5. Confirm `git diff --check`, a clean intended Git status, `main` as the current branch, and one registered worktree.
6. Confirm the active application, secrets, Vercel linkage, dependencies, submission kit, and production evidence remain.

## Completion criteria

The repository contains a coherent, validated Mintlify documentation site grounded in current code. The parent workspace contains only the active repository. Reproducible build/test caches are absent. Git reports one worktree on `main`, and no required deployment, development, evidence, or submission asset was removed.
