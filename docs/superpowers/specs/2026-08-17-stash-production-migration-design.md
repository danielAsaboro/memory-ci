# Stash Production Migration Design

## Summary

Stash is the production identity of the existing Memory CI application. It lets teams propose, screen, evaluate, approve, promote, inspect, and roll back AI-agent memory with the same controls used for code releases.

The public application will run at `https://trystash.xyz`. Vercel will serve the Next.js reviewer console and same-origin gateway. The authoritative application backend will remain on AWS, and CockroachDB Cloud will remain the transactional and vector-memory system of record. The public source repository is `https://github.com/danielAsaboro/stash-cockcroachdb`.

## Success Criteria

1. Every user-visible reference to Memory CI is replaced with Stash, except historical notes that explicitly explain the rename.
2. `trystash.xyz` serves the production application from the existing Vercel `stash` project.
3. A first-time visitor can create an isolated workspace without receiving shared demo credentials.
4. Candidate creation, screening, evaluation, review, promotion, memory retrieval, audit inspection, and rollback use live APIs and persist in CockroachDB.
5. Refreshing or reopening a workspace preserves its state.
6. Bedrock evaluations, S3 evidence artifacts, EventBridge lifecycle events, and Lambda execution are surfaced only when authenticated production calls succeed.
7. Failures are explicit and fail closed. Provider timeouts, malformed judgments, missing evidence, stale revisions, or unavailable infrastructure cannot be displayed as successful evaluations.
8. Unit, integration, browser, accessibility, production smoke, and deployment evidence checks pass.
9. The renamed repository is public, buildable, documented, and contains no credentials.

## Chosen Architecture

### Product surface

The existing vinext application will be migrated to standard Next.js so it can use the existing Vercel project's native build and runtime. The current route structure and visual system will be preserved where they remain useful. Metadata, social assets, navigation, onboarding copy, environment indicators, and documentation will be rewritten for Stash.

Vercel is responsible for:

- rendering the application;
- issuing and refreshing the browser's secure workspace session;
- proxying browser requests through same-origin `/api` routes;
- keeping AWS endpoints and browser-facing configuration out of client bundles.

### Execution and memory plane

AWS API Gateway and Lambda expose the application API. Lambda executes the existing lifecycle services and connects to CockroachDB Cloud using a least-privilege runtime account delivered through Secrets Manager.

CockroachDB stores tenants, principals, agent namespaces, sources, candidates, screening findings, scenarios, evaluation runs and results, reviews, immutable audit events, memory versions, lineage, revision counters, idempotency keys, and the transactional outbox. Embeddings use the existing `VECTOR(1024)` columns and distributed vector indexes.

Bedrock performs model-assisted semantic risk and behavioral evaluation. S3 stores content-addressed evidence. The transactional outbox is dispatched to EventBridge only after the database transaction commits.

### Workspace session

A visitor starts an isolated Stash workspace through a same-origin session endpoint. The backend creates a tenant, principal, namespace, initial agent, and realistic starter memory in one idempotent transaction. It returns a short-lived signed session in a secure, HTTP-only, same-site cookie. The browser never receives database or AWS credentials.

The starter records are ordinary persisted application records. They make the product immediately understandable but do not contain precomputed successes. Poisoning attempts, evaluations, approvals, promotions, and rollbacks run through the same production services as user-created inputs.

The API derives tenant and principal identity from the verified session. Every repository query remains tenant-scoped. Session creation is rate-limited, request bodies are bounded, and state-changing requests require same-origin checks and idempotency keys.

## User Experience

### Onboarding

The landing route explains Stash in one sentence and offers `Create workspace`. Creation shows real progress states for session creation, CockroachDB initialization, and agent setup. On success the user lands in Overview with one clear recommended action.

The interface will no longer say `Sandbox demo`, `fixture`, or `cloud proof pending`. Instead, it will show the actual status of CockroachDB, AWS evaluation services, and the selected agent. If an optional provider is unavailable, the affected action is disabled with a precise recovery message while read-only data remains available.

### Core journey

1. Propose a memory change with source and provenance.
2. Screen it for deterministic poisoning and policy violations.
3. Run recorded behavioral scenarios and Bedrock-assisted judgments.
4. Review the evidence and approve or reject the bound candidate digest.
5. Promote the approved candidate atomically.
6. Retrieve active memory through semantic search.
7. Inspect audit history and lineage.
8. Roll back to a previous committed version.

Pages render loading, empty, partial, success, and failure states from server data. Optimistic UI is limited to reversible presentation changes; lifecycle transitions wait for authoritative responses.

## API Changes

The current lifecycle router and service boundaries remain authoritative. Demo-only reset and scripted mutation routes are removed from the production surface. New session/bootstrap endpoints create and restore isolated workspaces. List and detail endpoints are added where the current UI relies on static imports.

The frontend uses typed query functions for:

- integration and workspace status;
- agents and namespaces;
- candidate queues and candidate details;
- evaluation matrices and evidence;
- active memories, semantic search, and lineage;
- audit events;
- lifecycle mutations.

All mutations return request IDs and structured domain errors. Long-running evaluation returns an accepted operation identifier and is polled with bounded backoff.

## Branding and Compatibility

User-facing names, package metadata, application titles, social metadata, AWS display names, log labels, event sources, example configuration, and documentation move to Stash. Existing database table names and migration history remain unchanged because they are internal, already tested, and renaming them would add migration risk without improving the product.

Historical Git commits remain intact. The local project directory may remain `memory-ci` during the migration, but the package, deployment, repository, and product identities become Stash. The Git remote changes to `https://github.com/danielAsaboro/stash-cockcroachdb` only after verifying that the destination repository is the intended public target.

## Security and Failure Handling

- Database and AWS credentials are server-only secrets.
- Logs and audit events contain safe identifiers rather than raw memory content.
- CockroachDB transactions retain serializable retry, idempotency, tenant scoping, active-version uniqueness, and immutable audit-chain controls.
- Session cookies are secure, HTTP-only, same-site, rotated, and short-lived.
- Cross-origin state changes are rejected.
- Bedrock timeout or malformed output produces `inconclusive`, never `passed`.
- Missing S3 evidence blocks review or promotion when the policy requires it.
- Stale revision, digest, policy, or evaluation bindings block promotion.
- The UI distinguishes infrastructure failure from policy rejection.

## Testing and Verification

Implementation uses tests before production changes where practical. Verification includes:

- domain and router unit tests;
- CockroachDB integration tests against real migrations and transactions;
- session, tenant-isolation, idempotency, and failure-path tests;
- frontend component tests for loading, empty, live, and error states;
- Playwright onboarding and full lifecycle journeys on desktop and mobile;
- accessibility checks;
- Next.js production build and Vercel preview smoke tests;
- AWS health, Bedrock, S3, EventBridge, and CockroachDB evidence checks using authenticated resources;
- production smoke tests against `https://trystash.xyz`.

No integration is described as live until a production request and its corresponding persistent or provider evidence have been verified.

## Deployment Sequence

1. Rename and migrate the application locally while preserving tested domain services.
2. Create or select the CockroachDB Cloud production cluster, run migrations, and configure least-privilege roles.
3. Deploy the AWS SAM stack and verify API health and service evidence.
4. Configure the Vercel `stash` project with only the gateway and session secrets it needs.
5. Deploy a Vercel preview and run the complete browser journey.
6. Promote the verified deployment to production and confirm `trystash.xyz` aliases it.
7. Point the local Git remote at the renamed public repository, push the verified source, and confirm CI.
8. Update public documentation and hackathon evidence with the production URLs and verified integrations.

## Rejected Alternatives

### All application logic on Vercel

This is operationally simpler but weakens the hackathon story and may fail the requirement that the application be deployed on AWS.

### Static Vercel frontend over deterministic fixture data

This would change the domain without making the product functional. It is explicitly out of scope.

### Shared public demo tenant

This reduces onboarding work but creates cross-user interference, unreliable judging, and avoidable privacy and abuse risks.

## Non-Goals

- Rewriting the already tested lifecycle domain from scratch.
- Renaming stable internal database tables solely for branding.
- Adding billing, organization invitations, or enterprise SSO before the core live journey works.
- Claiming CockroachDB Managed MCP or `ccloud` execution without authenticated evidence.
- Preserving the ChatGPT Sites deployment as the canonical product URL.
