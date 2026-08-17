"use client";

import { ArrowUpRight, Filter } from "lucide-react";
import { useState } from "react";

import type { CandidateSummary } from "../../src/contracts/dashboard";

export function ChangeQueue({ candidates }: { candidates: CandidateSummary[] }) {
  const [state, setState] = useState("all");
  const visible = candidates.filter((candidate) => state === "all" || candidate.state === state);
  return <section className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">Candidate queue</span><h2>Memory changes</h2></div><label className="filter-control"><Filter size={14} /><span className="sr-only">Filter by state</span><select value={state} onChange={(event) => setState(event.target.value)}><option value="all">All states</option><option value="review_required">Review required</option><option value="quarantined">Quarantined</option><option value="approved">Approved</option></select></label></div>
    <div className="queue-table" role="table"><div className="queue-row queue-header" role="row"><span role="columnheader">Change</span><span role="columnheader">Class</span><span role="columnheader">Trust</span><span role="columnheader">State</span><span role="columnheader">Findings</span><span role="columnheader" aria-label="Open change" /></div>
      {visible.map((candidate) => <div role="row" className="queue-row" key={candidate.id}>
        <span role="cell" className="queue-title"><a href={`/changes/${candidate.id}`}><strong>{candidate.canonicalText}</strong><small>{candidate.namespaceName} · {candidate.author.name}</small></a></span>
        <span role="cell"><span className="tag">{candidate.memoryClass}</span></span><span role="cell"><span className={`risk-badge ${candidate.trustClass === "untrusted" ? "critical" : "low"}`}>{candidate.trustClass}</span></span>
        <span role="cell" className={`state-text ${candidate.state}`}>{candidate.state.replaceAll("_", " ")}</span><span role="cell">{candidate.blockingFindingCount ? `${candidate.blockingFindingCount} blocking` : `${candidate.findingCount} recorded`}</span><span role="cell"><a href={`/changes/${candidate.id}`} aria-label={`Open ${candidate.canonicalText}`}><ArrowUpRight size={14} /></a></span>
      </div>)}
      {!visible.length ? <div role="row" className="queue-row queue-empty"><span role="cell" className="queue-title"><strong>No memory changes are waiting for review</strong><small>When a candidate is submitted, its live evidence will appear here.</small></span><span role="cell" /><span role="cell" /><span role="cell" /><span role="cell" /><span role="cell" /></div> : null}
    </div>
  </section>;
}
