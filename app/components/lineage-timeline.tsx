"use client";

import { Check, GitCommitHorizontal, RotateCcw, X } from "lucide-react";
import { useState } from "react";

const versions = [
  { version: 3, revision: 12, value: "$150 review threshold", actor: "Amina M.", time: "8m", active: true },
  { version: 2, revision: 8, value: "$100 review threshold", actor: "Policy sync", time: "14d", active: false },
  { version: 1, revision: 2, value: "$75 review threshold", actor: "Bootstrap", time: "83d", active: false },
];

export function LineageTimeline() {
  const [target, setTarget] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  return <section className="panel lineage-panel"><div className="panel-heading"><div><span className="eyebrow">Immutable history</span><h2>Lineage timeline</h2></div><span className="tag">3 versions</span></div><ol className="lineage-list">{versions.map((item) => <li key={item.version}><span className={item.active ? "timeline-dot active" : "timeline-dot"}><GitCommitHorizontal size={13} /></span><div><strong>Version {item.version} {item.active ? <span className="active-pill">Active</span> : null}</strong><p>{item.value}</p><small>revision {item.revision} · {item.actor} · {item.time}</small></div>{!item.active ? <button className="button subtle" onClick={() => setTarget(item.version)}><RotateCcw size={13} />Roll back to version {item.version}</button> : null}</li>)}</ol>
    {target ? <div className="modal-scrim"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="rollback-title"><button className="icon-button dialog-close" aria-label="Close" onClick={() => setTarget(null)}><X size={16} /></button><RotateCcw size={22} /><h3 id="rollback-title">Create revision 13 from version {target}?</h3><p>The current version remains in immutable history. Agents move only after the new activation commits.</p><div><button className="button secondary" onClick={() => setTarget(null)}>Cancel</button><button className="button danger-button" onClick={() => { setMessage(`Rollback requested for version ${target}`); setTarget(null); }}><Check size={14} />Confirm rollback</button></div></div></div> : null}<span className="sr-only" role="status">{message}</span>
  </section>;
}
