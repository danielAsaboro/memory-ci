# Memory CI

**Ship memory with the same discipline as code.**

Memory CI is a control plane for proposing, evaluating, approving, activating,
explaining, and rolling back AI-agent memory. It is being built for the
[CockroachDB × AWS Hackathon](https://cockroachdb-ai.devpost.com/).

Memory CI treats every durable memory write as a change request. CockroachDB
stores transactional state, provenance, evaluations, lineage, and vector
embeddings. AWS evaluates behavioral consequences and preserves provider
evidence. Agents retrieve only committed memory revisions.

## Status

The project is under active development. Cloud integrations must fail closed;
local packaging or deterministic rule tests are never presented as evidence of
an authenticated AWS or CockroachDB Cloud deployment.

## Local foundation

Requirements: Node.js 22.13 or newer and npm.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Verification commands:

```bash
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

The application is licensed under the [MIT License](LICENSE).
