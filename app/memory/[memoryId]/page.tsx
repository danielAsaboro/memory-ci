import { ArrowLeft, Braces, Network } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LineageTimeline } from "../../components/lineage-timeline";
import { memories } from "../../lib/demo-data";

export default async function MemoryDetailPage({ params }: { params: Promise<{ memoryId: string }> }) {
  const { memoryId } = await params; const memory = memories.find((item) => item.id === memoryId); if (!memory) notFound();
  return <><Link href="/memory" className="back-link"><ArrowLeft size={14} />Back to memory</Link><div className="change-hero"><div><div className="change-meta"><span className="risk-badge low">active</span><span>{memory.namespace}</span><span>{memory.memoryClass}</span></div><h1>{memory.title}</h1><p>{memory.stableKey} is currently serving at revision {memory.revision}.</p></div><div className="change-id"><small>Current version</small><strong>v{memory.version}</strong><small>24h reads</small><strong>{memory.reads}</strong></div></div><div className="memory-detail-grid"><LineageTimeline /><div className="detail-stack"><section className="evidence-card"><div className="mini-heading"><Braces size={15} />Canonical payload</div><pre className="payload-block">{JSON.stringify({ threshold: 150, currency: "USD", approval: "human" }, null, 2)}</pre></section><section className="evidence-card"><div className="mini-heading"><Network size={15} />Vector neighbors</div><div className="neighbor"><span>refund-destination</span><strong>0.082</strong></div><div className="neighbor"><span>high-value-escalation</span><strong>0.127</strong></div></section></div></div></>;
}
