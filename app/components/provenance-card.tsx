import { BadgeCheck, ExternalLink, Fingerprint } from "lucide-react";

export function ProvenanceCard({ source, trust, signature }: { source: string; trust: string; signature: string }) {
  return <section className="evidence-card"><div className="mini-heading"><Fingerprint size={15} /><span>Provenance</span></div><dl><div><dt>Source</dt><dd>{source} <ExternalLink size={11} /></dd></div><div><dt>Trust</dt><dd><span className={`trust-dot ${trust}`} />{trust}</dd></div><div><dt>Signature</dt><dd><BadgeCheck size={12} />{signature}</dd></div><div><dt>Digest</dt><dd className="mono">63f2…a91c</dd></div></dl></section>;
}
