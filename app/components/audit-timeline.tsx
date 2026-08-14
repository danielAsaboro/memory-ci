import { BadgeCheck, Download } from "lucide-react";

import { auditEvents } from "../lib/demo-data";

export function AuditTimeline() { return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Append-only evidence</span><h2>Audit events</h2></div><button className="button secondary"><Download size={13} />Export JSONL</button></div><div className="audit-list">{auditEvents.map((event) => <article key={event.request}><span className="audit-icon"><BadgeCheck size={14} /></span><div><strong>{event.action}</strong><p>{event.resource}</p><small>{event.actor} · {event.time}</small></div><dl><div><dt>Request</dt><dd>{event.request}</dd></div><div><dt>Provider</dt><dd>{event.provider}</dd></div></dl></article>)}</div></section>; }
