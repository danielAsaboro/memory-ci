# Stash — Ship Agent Memory Like Code

**Estimated runtime:** 2:45
**Audience:** CockroachDB AI Hackathon judges
**Core argument:** Durable agent memory is production state, so it needs the same evidence, review, atomicity, and rollback discipline as code.
**Tone:** Direct, technical, calm; no hype that the screen cannot prove.
**Production approach:** One continuous live workflow, interrupted only by short evidence callouts. Keep identifiers readable and never expose credentials or account IDs.

---

## [00:00–00:15] — The risk

**VISUAL:** Open the live Overview. Punch in on the active revision, candidates, evaluations, and audit counts. Title card: “Stash — Ship agent memory like code.”

**NARRATION**

```text
Agents do not just read data.
They accumulate durable instructions that change every future action.

One poisoned memory can quietly compromise the whole system.
Stash makes production memory ship like code.
```

---

## [00:15–00:40] — Stop poisoned memory before retrieval

**VISUAL:** Create or open the gift-card-routing proposal. Show untrusted provenance, the instruction-injection findings, quarantine state, and disabled approval. Use `captures/02-quarantined-change.jpg` only as fallback.

**NARRATION**

```text
This proposal tries to override prior instructions and redirect refunds to gift cards. Stash records its provenance, screens the exact content, returns two blocking findings, and quarantines it. The candidate never becomes active, so retrieval cannot serve it to an agent.
```

---

## [00:40–01:18] — Evaluate a legitimate change

**VISUAL:** Open the safe Northstar refund-policy proposal. Queue the evaluation. Show the completed result, provider receipt, evidence state, and digest-bound review before approving. Use `captures/03-approved-change.jpg` and `captures/05-evaluations.jpg` for inserts.

**NARRATION**

```text
Now a legitimate policy update enters the same pipeline. Deterministic checks run first. A recorded scenario compares baseline behavior with the candidate overlay, while Amazon Bedrock is restricted to a structured judgment. The completed run carries a provider request ID. Approval binds the content digest, evaluation, policy, and baseline—not just a human click.
```

---

## [01:18–01:43] — Promote atomically

**VISUAL:** Promote the approved candidate. Open the resulting memory detail and emphasize active revision 2. Brief overlay: “state + vector + audit + outbox / one serializable transaction.”

**NARRATION**

```text
Promotion is one serializable CockroachDB transaction. It rejects stale evidence, supersedes the previous version, activates the new memory, advances the namespace revision, appends the audit record, and writes the outbox event. The operational state and its vector cannot drift apart.
```

---

## [01:43–02:10] — Prove semantic memory

**VISUAL:** Open Memory Explorer and use its semantic retrieval form. Search by meaning, not an exact substring. Show the returned active memory, similarity score, namespace revision, and persisted read receipt. Then cut to sanitized terminal evidence for `VECTOR(1024)`, the distributed vector index definition, and `EXPLAIN`.

**NARRATION**

```text
This is persistent memory, not a keyword demo. Bedrock produces a 1,024-dimensional embedding, CockroachDB's distributed vector index searches only active memory in the tenant and namespace, and Stash persists what the agent read. Transactional truth and semantic retrieval share one consistency boundary.
```

---

## [02:10–02:29] — Name the qualifying tools and AWS proof

**VISUAL:** Show the sanitized `ccloud` cluster receipt beside `docs/evidence/stash-production.json`. Highlight AWS, `us-east-1`, cluster created, vector index ready, and correlated Bedrock/Lambda/S3/EventBridge request evidence. Do not show secrets or full account identifiers.

**NARRATION**

```text
The build uses CockroachDB Distributed Vector Indexing, the ccloud CLI for live cluster evidence, and CockroachDB Agent Skills during implementation review. It runs on AWS with Bedrock, Lambda, API Gateway, S3, and EventBridge. The public redacted receipt correlates the live provider and database evidence.
```

---

## [02:29–02:45] — Roll forward, never erase history

**VISUAL:** Trigger a rollback after a lineage has two versions. Show that rollback creates a new forward revision, then open Audit and highlight the linked events. End on `https://trystash.xyz` and the public repository URL.

**NARRATION**

```text
Rollback does not erase history. It creates another reviewed forward revision and preserves the audit chain. Stash governs what agents are allowed to remember—and gives every change evidence, lineage, and a safe way back.
```

---

## Claim guardrails

Do not say that browser users authenticate through Cognito, that the deployment proves global failover, that two agents have read the same revision, or that visible search is semantic until the screen demonstrates those facts. Do not describe environment-variable presence as service health.
