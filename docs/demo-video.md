# 2:45 demo video script

**0:00–0:15 — Problem.** “Agents write durable instructions constantly. One poisoned memory can silently change every future action. Memory CI makes memory ship like code.” Show Overview and the production revision.

**0:15–0:42 — Poison attempt.** Run the gift-card-routing candidate. Open its change. Point to untrusted provenance, critical instruction-injection finding, and automatic quarantine. “The candidate never enters retrieval.”

**0:42–1:20 — Legitimate change.** Open the signed refund-policy update from $100 to $150. Show baseline/candidate behavioral trajectories, deterministic tool constraints, Bedrock judgment, evidence URI, and digest-bound approval.

**1:20–1:43 — Atomic promotion.** Promote it. Show namespace revision increment and two agents reading the same active revision. “Operational state and vectors commit together in CockroachDB.”

**1:43–2:08 — Why CockroachDB.** Show the Memory lineage and Vector evidence terminal: `VECTOR(1024)`, distributed index metadata, `EXPLAIN`, and the neighbor result. Show audit digest chaining.

**2:08–2:28 — AWS.** Show the architecture: Bedrock evaluation, S3 evidence, Lambda API/sandbox/outbox, EventBridge delivery, Cognito identity. Briefly show SAM build output and authenticated request IDs if available.

**2:28–2:45 — Rollback.** Roll back to the previous version and show a new forward revision plus the immutable audit event. Close: “Memory CI: ship agent memory with the same discipline as code.”
