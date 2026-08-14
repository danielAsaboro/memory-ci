# Security policy

Please report vulnerabilities privately to the repository owner rather than opening a public issue.

## Deployment requirements

- Use a CockroachDB Cloud connection with TLS and the least-privilege `memory_ci_app` role; reserve migration privileges for a separate identity.
- Store the connection URL in AWS Secrets Manager. Never commit `.env` files, cloud evidence containing credentials, or Cognito tokens.
- Restrict `AllowedOrigin`, enable Cognito MFA for reviewers, and map each Cognito `sub` to one active tenant principal.
- Keep the S3 evidence bucket private and preserve versioning, encryption, and retention controls from the SAM template.
- Treat candidates and model output as untrusted. Do not bypass screening, forced-tool validation, stale-review checks, or idempotency requirements.

Cloud demo reset endpoints are disabled. Local fixture reset is intended only for disposable development databases.
