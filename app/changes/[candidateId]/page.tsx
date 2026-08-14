import { ArrowLeft, FlaskConical, GitBranch, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BehavioralDiff } from "../../components/behavioral-diff";
import { MemoryDiffRail } from "../../components/memory-diff-rail";
import { ProvenanceCard } from "../../components/provenance-card";
import { ReviewActions } from "../../components/review-actions";
import { changes } from "../../lib/demo-data";

export default async function ChangeDetailPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await params;
  const change = changes.find((item) => item.id === candidateId);
  if (!change) notFound();
  const poisoned = change.risk === "critical";
  return <><Link href="/changes" className="back-link"><ArrowLeft size={14} />Back to changes</Link><div className="change-hero"><div><div className="change-meta"><span className={`risk-badge ${change.risk}`}>{change.risk} risk</span><span>{change.namespace}</span><span>{change.memoryClass}</span></div><h1>{change.title}</h1><p>{change.summary}</p></div><div className="change-id"><small>Candidate</small><code>{change.id}</code><small>Baseline revision</small><strong>{poisoned ? "11" : "12"}</strong></div></div>
    <MemoryDiffRail before={change.before} after={change.after} />
    <div className="evidence-grid"><ProvenanceCard source={change.source} trust={change.trust} signature={change.signature} /><BehavioralDiff poisoned={poisoned} /></div>
    <section className="panel findings-panel"><div className="panel-heading"><div><span className="eyebrow">Evaluation evidence</span><h2>{poisoned ? "Controls stopped this change" : "Ready for human review"}</h2></div><span className={`state-text ${change.state}`}>{change.state.replace("_", " ")}</span></div><div className="finding-grid">{change.findings.map((finding,index) => <div key={finding}><span>{index === 0 ? <ShieldAlert size={15} /> : index === 1 ? <GitBranch size={15} /> : <FlaskConical size={15} />}</span><strong>{finding}</strong><small>{poisoned ? "Blocking evidence" : "Verified in sandbox suite"}</small></div>)}</div></section>
    <ReviewActions blocked={poisoned} />
  </>;
}
