import { BadgeCheck, ExternalLink } from "lucide-react";

const receipt = {
  verifiedAt: "2026-08-17T18:38:41.216Z",
  cluster: "AWS · us-east-1 · BASIC · CREATED",
  vector: "VECTOR(1024)",
  index: "memory_versions_active_embedding_idx",
  model: "amazon.titan-embed-text-v2:0",
};

export function ProductionEvidence() {
  return <section className="panel production-evidence">
    <div className="panel-heading"><div><span className="eyebrow">Independent inspection</span><h2>Production verification receipt</h2></div><span className="risk-badge low"><BadgeCheck size={11} />verified</span></div>
    <p className="evidence-intro">A redacted machine-readable receipt records the deployed providers and query plan. This is build-time production evidence, not a claim inferred from the current browser session.</p>
    <div className="verification-grid">
      <article><small>CockroachDB Cloud</small><strong>{receipt.cluster}</strong><span>Cluster state captured by ccloud.</span></article>
      <article><small>Distributed vector search</small><strong>{receipt.vector}</strong><span><code>{receipt.index}</code> ready, visible, and selected by EXPLAIN.</span></article>
      <article><small>Managed embedding</small><strong>AWS Bedrock</strong><span>{receipt.model} · provider request ID recorded.</span></article>
    </div>
    <footer><span>Verified {new Date(receipt.verifiedAt).toISOString()}</span><a href="/evidence/stash-production.json" target="_blank" rel="noreferrer">Inspect redacted receipt <ExternalLink size={12} /></a></footer>
  </section>;
}
