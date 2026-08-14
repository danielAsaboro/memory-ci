import { AuditTimeline } from "../components/audit-timeline";

export default function AuditPage() { return <><div className="page-header"><div><span className="eyebrow">Verifiable operations</span><h1>Audit trail</h1><p>Application actions, CockroachDB mutations, and AWS provider receipts in one append-only view.</p></div><span className="status-chip good"><span />Digest chain verified</span></div><AuditTimeline /></>; }
