# Security policy

Please report vulnerabilities privately to the repository owner rather than opening a public issue.

## Deployment requirements

- Use a CockroachDB Cloud connection with TLS and the least-privilege `memory_ci_app` role; reserve migration privileges for a separate identity.
- Store the connection URL in AWS Secrets Manager. Never commit `.env` files, cloud evidence containing credentials, or Cognito tokens.
- Keep the canonical browser origin fixed at `https://trystash.xyz`; API CORS must not allow other origins. Enable Cognito MFA for reviewers, and map each Cognito `sub` to one active tenant principal.
- Keep the S3 evidence bucket private and preserve versioning, encryption, and retention controls from the SAM template.
- Treat candidates and model output as untrusted. Do not bypass screening, forced-tool validation, stale-review checks, or idempotency requirements.
- Configure `DATABASE_SECRET_ARN`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `EVIDENCE_BUCKET`, and `EVENT_BUS_NAME` only in the AWS runtime. Configure `STASH_API_BASE_URL`, `STASH_BOOTSTRAP_KEY`, and `STASH_SESSION_SECRET` only as Vercel server variables. `NEXT_PUBLIC_APP_URL` is the sole browser-visible runtime key and must be exactly `https://trystash.xyz`.
- Run `npm run production:audit` after every production build. It emits JSON and fails for demo copy, unsafe browser environment keys, canonical-origin drift, missing response headers, or secret-shaped source-map content.

Cloud demo reset endpoints are disabled. Local fixture reset is intended only for disposable development databases.
