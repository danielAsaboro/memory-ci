import { BadgeCheck, Download } from "lucide-react";

import type { AuditEvent } from "../../src/contracts/dashboard";
import { EmptyState } from "./async-state";

export function AuditTimeline({ events }: { events: AuditEvent[] }) { return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Append-only evidence</span><h2>Audit events</h2></div><button className="button secondary" disabled title="Export is read-only and will be enabled with lifecycle operations"><Download size={13} />Export JSONL</button></div><div className="audit-list">{events.map((event) => <article key={event.id}><span className="audit-icon"><BadgeCheck size={14} /></span><div><strong>{event.action}</strong><p>{event.resource.type} · {event.resource.id}</p><small>{event.actor.name} · {new Date(event.createdAt).toLocaleString()}</small></div><dl><div><dt>Request</dt><dd>{event.requestId}</dd></div><div><dt>Provider</dt><dd>{event.providerRequestId ?? "Not supplied"}</dd></div></dl></article>)}{!events.length ? <EmptyState title="No audit events are available" detail="Verified operations will be recorded here." /> : null}</div></section>; }
