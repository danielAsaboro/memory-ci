"use client";

import { ArrowUpRight, Filter } from "lucide-react";
import { useState } from "react";

import { changes } from "../lib/demo-data";

export function ChangeQueue() {
  const [risk, setRisk] = useState("all");
  const visible = changes.filter((change) => risk === "all" || change.risk === risk);
  return <section className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">Candidate queue</span><h2>Memory changes</h2></div><label className="filter-control"><Filter size={14} /><span className="sr-only">Filter by risk</span><select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="all">All risk</option><option value="critical">Critical</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div>
    <div className="queue-table" role="table"><div className="queue-row queue-header" role="row"><span role="columnheader">Change</span><span role="columnheader">Class</span><span role="columnheader">Risk</span><span role="columnheader">State</span><span role="columnheader">Age</span><span role="columnheader" aria-label="Open change" /></div>
      {visible.map((change) => <div role="row" className="queue-row" key={change.id}>
        <span role="cell" className="queue-title"><a href={`/changes/${change.id}`}><strong>{change.title}</strong><small>{change.namespace} · {change.author}</small></a></span>
        <span role="cell"><span className="tag">{change.memoryClass}</span></span><span role="cell"><span className={`risk-badge ${change.risk}`}>{change.risk}</span></span>
        <span role="cell" className={`state-text ${change.state}`}>{change.state.replace("_", " ")}</span><span role="cell">{change.age}</span><span role="cell"><a href={`/changes/${change.id}`} aria-label={`Open ${change.title}`}><ArrowUpRight size={14} /></a></span>
      </div>)}
    </div>
  </section>;
}
