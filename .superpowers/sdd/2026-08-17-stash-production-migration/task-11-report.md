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
   export BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
   export STASH_BEDROCK_LOGGING_ROLE_ARN="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='BedrockLoggingRoleArn'].OutputValue" --output text)"
   export STASH_BOOTSTRAP_KEY='retrieve-securely-from-production-parameter-source'
   STASH_PRODUCTION_EVIDENCE=1 COCKROACH_CLUSTER_ID='cloud-cluster-id' npm run vector:evidence -- /tmp/stash-vector-evidence.json
   npm run aws:smoke -- /tmp/stash-aws-smoke.json
   STASH_SMOKE_EVIDENCE_FILE=/tmp/stash-aws-smoke.json STASH_VECTOR_EVIDENCE_FILE=/tmp/stash-vector-evidence.json npm run cloud:evidence -- docs/evidence/stash-production.json
   ```

5. Inspect the generated receipt, confirm it contains only redacted identifiers, then commit it with the tooling changes.

## Fix Round 2

- Replaced the permissive receipt envelope with strict, discriminated schema-v2 `aws-smoke`, `vector`, and `ccloud` receipts. Context-only receipts fail. Receipt assembly requires identical run ID, fresh timestamps, complete AWS account/region/stack/API/bucket/event-bus/secret/model context, complete CockroachDB organization/cluster/provider/region/tier/host context, and same workspace/probe/SQL-cluster/index semantics.
- Added `evidence:context`, which builds the sole shared context from independently queried STS and CloudFormation stack data. `cloud:evidence` independently repeats those checks and exactly matches CloudFormation outputs and parameters, STS account, structured CloudWatch run/request/trace record, and the exact X-Ray root.
- Smoke captures `startedAt` before its first request, never accepts a caller-provided trace ID, propagates a fresh run ID through the API, requires the real X-Ray root response header, invokes exact evaluator and embedding model IDs, and binds its probe to the actual deterministic bootstrap memory version. The Lambda emits the structured correlation record only for evidence-run requests.
- Vector evidence requires the smoke receipt and queries that exact tenant/memory record; it requires `sslmode=verify-full`, authoritative SQL cluster identity, `embedding VECTOR(1024)`, the exact visible ready embedding index, and an `EXPLAIN` reference to that index. ccloud evidence parses only structured cluster JSON, requires organization/provider/region/tier/host, and accepts only exact `CREATED`, `RUNNING`, or `READY` states.
- Production migration preflight now requires verified TLS and exact SQL cluster identity before checking the dynamically discovered migration ledger. Parameter validation now requires actual Ed25519 public keys and a Secrets Manager ARN matching the deployment identity; deploy obtains that identity without including parameter values in SAM argv or logs.
- Expanded redaction to normalize common AWS/API/database credential key formats and credentials embedded in HTTP(S), PostgreSQL, JSON, and key/value provider errors. All receipt writes remain atomic.

### Fix Round 2 local verification

- Focused evidence/API/parameter/migration tests: 43 passing.
- `npm run verify`: passed — 253 unit tests/40 files, 30 integration tests/6 files, lint, typecheck, and production build.
- `npm run infra:validate`, `npm run infra:build`, and `npm run production:audit`: passed.

### Exact post-auth receipt sequence

Use a temporary directory and never print the database URL or parameter secrets. After AWS authentication is available and the authenticated CockroachDB Cloud identity facts are known:

```bash
export AWS_REGION=us-east-1 STASH_STACK_NAME=stash-production
export COCKROACH_CLUSTER_ID='authenticated-cluster-id'
export COCKROACH_ORGANIZATION_ID='authenticated-organization-id'
export COCKROACH_HOST='authenticated-cluster-host.cockroachlabs.cloud'
export COCKROACH_TIER=BASIC
export STASH_EVIDENCE_CONTEXT_FILE=/tmp/stash-evidence-context.json
export STASH_SMOKE_EVIDENCE_FILE=/tmp/stash-aws-smoke.json
export STASH_VECTOR_EVIDENCE_FILE=/tmp/stash-vector-evidence.json
export STASH_CCLOUD_EVIDENCE_FILE=/tmp/stash-ccloud-evidence.json
npm run evidence:context -- "$STASH_EVIDENCE_CONTEXT_FILE"
npm run ccloud:evidence -- "$STASH_CCLOUD_EVIDENCE_FILE"
export DATABASE_URL="$(< /tmp/stash-production-database-url)"
COCKROACH_CLUSTER_ID="$COCKROACH_CLUSTER_ID" npm run db:migrate
export DATABASE_SECRET_ARN="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Parameters[?ParameterKey=='DatabaseSecretArn'].ParameterValue" --output text)"
export EVIDENCE_BUCKET="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='EvidenceBucketName'].OutputValue" --output text)"
export EVENT_BUS_NAME="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='EventBusName'].OutputValue" --output text)"
export BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
export BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
export STASH_BEDROCK_LOGGING_ROLE_ARN="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='BedrockLoggingRoleArn'].OutputValue" --output text)"
export STASH_API_BASE_URL="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)"
export STASH_BOOTSTRAP_KEY='retrieve-securely-without-echoing'
npm run aws:smoke -- "$STASH_SMOKE_EVIDENCE_FILE"
STASH_PRODUCTION_EVIDENCE=1 npm run vector:evidence -- "$STASH_VECTOR_EVIDENCE_FILE"
npm run cloud:evidence -- docs/evidence/stash-production.json
```

## Fix Round 3

- Required exact `roles` arrays in both persisted workspace responses and added strict producer-shape parsing coverage. The smoke receipt now retains the S3 body digest and embeds the run ID in the uploaded artifact.
- Final collection independently reads the exact S3 object version, validates metadata and body SHA-256, requires the run ID in its JSON body, and retains the observed ETag. It no longer treats a nonempty producer ID as proof.
- Added a retained, stack-owned EventBridge-to-CloudWatch Logs observation target (`/aws/events/stash-production-observations`). The smoke event carries its run, S3, evaluator, and 1024-dimensional embedding facts; final evidence requires that AWS-owned record to exactly match the EventBridge event ID and both Bedrock model/provider-request IDs.
- Added bounded smoke duration validation; CloudWatch and X-Ray observations must fall within the captured smoke interval plus a short propagation grace. ccloud's inner cluster facts must exactly match the shared context and the vector SQL cluster proof.
- Vector evidence now obtains `embedding` type from `SHOW COLUMNS` and requires exact `VECTOR(1024)` on that column; index DDL is still checked for the exact visible embedding vector index used by `EXPLAIN`.
- Production migrations now establish a SQL connection and verify cluster identity before calling the mutating migration runner, then verify identity and the exact dynamic ledger again afterward. Redaction now handles quoted and escaped JSON secret fields.

### Fix Round 3 local verification

- Focused evidence/API/migration/template tests: 28 passing.
- Full verification, SAM validation/build, audit, and diff checks are run after this report update before commit.

### Updated post-auth note

Deploy the R3 SAM update before collecting evidence so the EventBridge observation rule/log group exists. Then use the same R2 sequence; `cloud:evidence` will now require the observed S3 object and `/aws/events/stash-production-observations` delivery record before it writes a final receipt.

## Fix Round 4

- Corrected EventBridge observation parsing to require the real AWS-delivered envelope top-level `id`, source, detail type, account, and region; old synthetic nested `detail.eventId` receipts are rejected.
- Added stack-owned Bedrock model invocation log group and delivery role. Deployment configures and verifies Bedrock invocation logging through the documented `PutModelInvocationLoggingConfiguration`/`GetModelInvocationLoggingConfiguration` API, while smoke preflights the same configuration. Smoke sends documented `X-Amzn-Bedrock-Request-Metadata` run/purpose tags on both `InvokeModel` calls; final evidence requires both Bedrock-owned `ModelInvocationLog` records rather than EventBridge echoes.
- Replaced the EOL evaluator with the verified `us.anthropic.claude-haiku-4-5-20251001-v1:0` US inference profile. Parameter/schema/examples now require it. API IAM grants the profile ARN plus the required us-east-1/us-west-2 underlying foundation-model ARNs; Titan v2 embedding is unchanged.

### Fix Round 4 local verification

- Focused evidence/parameter/smoke tests, typecheck, lint, and SAM validation passed before commit. No AWS live invocation, deployment, or evidence success claim was made.
- Final collector independently reads Bedrock model-invocation logging configuration and requires its exact stack output delivery role ARN, `/aws/bedrock/stash-production-invocations` group, and text/embedding flags before accepting Bedrock evidence.
- Final post-ETag full gate passed: `npm run verify` (258 unit tests/41 files; 30 integration tests/6 files), SAM validation/build, production audit (`{"ok":true,"violations":[]}`), and diff/status checks.
- Final R4 gate: `npm run verify` passed (257 unit tests/41 files; 30 integration tests/6 files), followed by passing SAM validation/build and production audit.

### R4 self-check

- Escaped credential-value redaction is implemented and covered by adversarial quoted/escaped JSON tests.
- Authoritative CockroachDB `SHOW JOBS` readiness correlation remains outstanding: current vector proof checks `SHOW COLUMNS`, `SHOW INDEX`, exact vector DDL, and `EXPLAIN`, but does not yet bind a matching vector-index creation job and `succeeded` state. This is a real pre-deployment hardening gap and must be completed before treating vector evidence as final production proof.

## Vector readiness follow-up

- Closed the `SHOW JOBS` readiness gap. Production vector evidence now queries the retained matching `memory_versions_embedding_idx` job, requires the latest exact table/index description to be `succeeded` with a finished timestamp, and records job ID/status/time in the strict receipt. Running, paused, failed, canceled, reverting, absent, and mismatched jobs fail closed with an instruction to rerun/repair the index migration.
- Focused vector/schema tests, typecheck, lint, and diff check passed. Full gates should be rerun after this final follow-up before deployment.
- Post-follow-up full gate passed: `npm run verify` (258 unit tests/41 files; 30 integration tests/6 files), `npm run infra:validate`, `npm run infra:build`, `npm run production:audit` (`{"ok":true,"violations":[]}`), and diff/status checks.

## Task 12 carried-correction command requirement

Before every live `npm run aws:smoke`, export the stack-owned Bedrock delivery role without printing it:

```bash
export STASH_BEDROCK_LOGGING_ROLE_ARN="$(aws cloudformation describe-stacks --stack-name "$STASH_STACK_NAME" --region "$AWS_REGION" --query "Stacks[0].Outputs[?OutputKey=='BedrockLoggingRoleArn'].OutputValue" --output text)"
npm run aws:smoke -- "$STASH_SMOKE_EVIDENCE_FILE"
```
