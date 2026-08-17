# Task 11 report — 2026-08-17

## Completed without cloud credentials

- Hardened `cloud:evidence` to fail closed unless it receives independently observed production health, idempotent workspace persistence, Bedrock, versioned S3 artifact, EventBridge, CockroachDB Cloud vector index, CloudWatch, and X-Ray receipts.
- Added recursive receipt redaction for account IDs, emails, tokens, credentials, and credential-bearing URLs. `ccloud:evidence` now uses the same redactor.
- Reworked `aws:smoke` to call the live health endpoint, prove idempotent workspace persistence, invoke Bedrock, write a versioned S3 artifact, and publish an EventBridge event. It writes an output only after all checks succeed.
- Reworked `vector:evidence` to select persisted memory rather than the Northstar fixture and to reject local/insecure connections when production evidence is requested.
- Added parameter-contract validation, a non-printing deploy command, and a production migration command. The migration runner invokes the existing sorted migrator, which selects `001` through `011`.
- Updated SAM with the managed 1024-dimension Titan embedding model, canonical allowed origin, trusted public-key registry configuration, CockroachDB Secrets Manager ARN, and isolated API/outbox/sandbox least-privilege roles.
- Added the redacted-evidence schema guidance in `docs/evidence/README.md`. No `docs/evidence/stash-production.json` was created.

## Local verification

- Focused unit tests: 17 passing (`scripts/{cloud-evidence,aws-smoke,vector-evidence,production-parameters}.test.ts`, `infra/template.test.ts`).
- Full verification gate: `npm run verify` passed — 237 unit tests across 37 files, 30 integration tests across 6 files, ESLint, typecheck, and production build.
- `npm run typecheck` passed.
- `npm run production:parameters -- infra/parameters.example.json` passed.
- `npm run infra:validate` passed.
- `npm run infra:build` passed.
- `npm run production:audit` passed with `{"ok":true,"violations":[]}`.
- Applied the requested one-line lint hygiene carryover in `src/services/retrieve-memory.ts` (`let memories` → `const`); it does not alter either retrieval branch or the persisted read receipt.

## External blockers

- `ccloud auth whoami` is not authenticated.
- `aws sts get-caller-identity` has no credentials.
- The browser is paused at the final persistent CockroachDB GitHub OAuth authorization. Do not approve it without an explicit, current user action-time confirmation.

## Fix Round 1

- Added schema-version-2 evidence contexts and receipt correlation checks for run ID, freshness, AWS account/region/stack/API/bucket/event bus/models, and Cockroach cluster/org/region/tier/host. Final evidence rejects mixed contexts, stale receipts, local/fixture clusters, unrelated CloudWatch request IDs, and unrelated X-Ray trace IDs.
- Switched evidence outputs to atomic temporary-file rename and centralized recursive error/URL/token redaction. `ccloud` now parses structured JSON and rejects non-AWS, non-`us-east-1`, inactive, fixture, and non-Cloud clusters.
- Hardened production migrations with Cloud-host/TLS preflight and dynamic migration-ledger equality checks. Added managed embedding invocation and 1024-dimension validation to AWS smoke. Vector evidence now rejects private targets, verifies SQL cluster identity, visible embedding columns, VECTOR(1024), vector-index DDL, and the chosen index in `EXPLAIN`.
- Production parameters now reject placeholders, invalid Secret ARNs, unsupported models, and empty/invalid trusted-key registries; the deploy wrapper validates first and sends only `file://<parameter-file>` to SAM. Added required X-Ray write actions to each custom Lambda role.
- Verification: `npm run verify` passed (249 unit tests/40 files; 30 integration tests/6 files; lint, typecheck, build). SAM validation/build and production audit passed. The intentionally placeholder-only `infra/parameters.example.json` now fails `production:parameters`, as required, before deployment.

## Minimal post-auth sequence

1. Authenticate, with the browser authorization action confirmed by the user, then verify identities:

   ```bash
   ccloud auth login
   ccloud auth whoami -o json
   aws login
   aws sts get-caller-identity
   ```

2. Create/select the `us-east-1` CockroachDB Cloud cluster and database `stash`; use an administrative `DATABASE_URL` to apply every migration and retain the runtime role from the migrations. Store the runtime connection JSON in Secrets Manager and capture its ARN without committing the value:

   ```bash
   export DATABASE_URL='retrieved-securely-from-cockroachdb-cloud'
   npm run db:migrate
   export DATABASE_SECRET_ARN='arn-returned-by-secrets-manager'
   ```

3. Create ignored `infra/parameters.production.json` from `infra/parameters.example.json`, replacing only the placeholders with the secret ARN, two server secrets, and trusted Ed25519 public-key registry JSON. Then validate, build, and deploy:

   ```bash
   npm run production:parameters
   npm run infra:validate
   npm run infra:build
   npm run deploy:production
   ```

4. Capture the real production receipts (temporary inputs remain outside the repository; only the redacted final receipt is written under `docs/evidence/`):

   ```bash
   export AWS_REGION=us-east-1 STASH_STACK_NAME=stash-production
   export STASH_API_BASE_URL="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
   export EVIDENCE_BUCKET="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='EvidenceBucketName'].OutputValue" --output text)"
   export EVENT_BUS_NAME="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='EventBusName'].OutputValue" --output text)"
   export BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0
   export STASH_BOOTSTRAP_KEY='retrieve-securely-from-production-parameter-source'
   STASH_PRODUCTION_EVIDENCE=1 COCKROACH_CLUSTER_ID='cloud-cluster-id' npm run vector:evidence -- /tmp/stash-vector-evidence.json
   npm run aws:smoke -- /tmp/stash-aws-smoke.json
   STASH_SMOKE_EVIDENCE_FILE=/tmp/stash-aws-smoke.json STASH_VECTOR_EVIDENCE_FILE=/tmp/stash-vector-evidence.json npm run cloud:evidence -- docs/evidence/stash-production.json
   ```

5. Inspect the generated receipt, confirm it contains only redacted identifiers, then commit it with the tooling changes.
