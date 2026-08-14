"use client";

import { ArrowUpRight, Filter } from "lucide-react";
import { useState } from "react";

import { changes } from "../lib/demo-data";

export function ChangeQueue() {
  const [risk, setRisk] = useState("all");
  const visible = changes.filter((change) => risk === "all" || change.risk === risk);
  return <section className="panel queue-panel"><div className="panel-heading"><div><span className="eyebrow">Candidate queue</span><h2>Memory changes</h2></div><label className="filter-control"><Filter size={14} /><span className="sr-only">Filter by risk</span><select value={risk} onChange={(event) => setRisk(event.target.value)}><option value="all">All risk</option><option value="critical">Critical</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div>
    <div className="queue-table" role="table"><div className="queue-row queue-header" role="row"><span>Change</span><span>Class</span><span>Risk</span><span>State</span><span>Age</span><span /></div>
      {visible.map((change) => <a role="row" className="queue-row" href={`/changes/${change.id}`} key={change.id}>
        <span className="queue-title"><strong>{change.title}</strong><small>{change.namespace} · {change.author}</small></span>
        <span><span className="tag">{change.memoryClass}</span></span><span><span className={`risk-badge ${change.risk}`}>{change.risk}</span></span>
        <span className={`state-text ${change.state}`}>{change.state.replace("_", " ")}</span><span>{change.age}</span><ArrowUpRight size={14} />
      </a>)}
    </div>
  </section>;
}
