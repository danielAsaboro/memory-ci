"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, GitPullRequestArrow, ShieldAlert, TimerReset } from "lucide-react";
import Link from "next/link";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { ChangeQueue } from "../components/change-queue";
import { MetricCard } from "../components/metric-card";
import { getCandidates, getOverview, queryKeys } from "../lib/api-client";

export default function OverviewPage() { return <WorkspaceBoundary>{(workspaceId) => <Overview workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Overview({ workspaceId }: { workspaceId: string }) {
  const overview = useQuery({ queryKey: queryKeys.overview(workspaceId), queryFn: getOverview });
  const candidates = useQuery({ queryKey: queryKeys.candidates(workspaceId), queryFn: getCandidates });
  if (overview.isError) return <TerminalError title="Overview data is unavailable" error={overview.error} onRetry={() => overview.refetch()} />;
  if (candidates.isError) return <TerminalError title="Candidate queue is unavailable" error={candidates.error} onRetry={() => candidates.refetch()} />;
  if (overview.isLoading || candidates.isLoading || !overview.data || !candidates.data) return <AsyncSkeleton label="Loading workspace overview" />;
  const data = overview.data; const next = candidates.data[0];
  return <><section className="overview-hero"><div><span className="eyebrow">Governed memory for AI agents</span><h2>Ship trusted memory to agents. Stop poisoned context before it ships.</h2><p>Stash screens proposed memory, evaluates behavior, requires human review, versions every release in CockroachDB, and records exactly what each agent retrieves.</p><div className="hero-actions">{next ? <Link href={`/changes/${next.id}`} className="button primary">Review a live change <ArrowRight size={15} /></Link> : <Link href="/changes" className="button primary">Propose a memory change <ArrowRight size={15} /></Link>}<Link href="/memory" className="button secondary">Run agent retrieval</Link><Link href="/settings" className="proof-link">Inspect production proof <ArrowRight size={13} /></Link></div></div><ol><li><span>01</span><strong>Screen</strong><small>Provenance and poison checks</small></li><li><span>02</span><strong>Prove</strong><small>Behavioral evaluation and review</small></li><li><span>03</span><strong>Serve</strong><small>Versioned vector retrieval receipts</small></li></ol></section>
    <div className="page-header overview-workspace"><div><span className="eyebrow">Live workspace</span><h1>{data.workspace.name}</h1><p>{data.metrics.candidates} candidate{data.metrics.candidates === 1 ? "" : "s"} and {data.metrics.activeMemories} active memor{data.metrics.activeMemories === 1 ? "y" : "ies"} are reported by this workspace.</p></div>{next ? <Link href={`/changes/${next.id}`} className="button secondary">Review next change <ArrowRight size={15} /></Link> : <button className="button secondary" disabled>No changes to review</button>}</div>
    <div className="metric-grid"><MetricCard label="Candidates" value={String(data.metrics.candidates)} detail="Live workspace total" icon={GitPullRequestArrow} tone="cobalt" /><MetricCard label="Active memories" value={String(data.metrics.activeMemories)} detail="Live workspace total" icon={Bot} /><MetricCard label="Evaluation runs" value={String(data.metrics.evaluations)} detail="Recorded by provider" icon={ShieldAlert} tone="red" /><MetricCard label="Audit events" value={String(data.metrics.auditEvents)} detail="Append-only records" icon={TimerReset} /></div>
    <div className="overview-grid"><ChangeQueue candidates={candidates.data} /><aside className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">Live controls</span><h2>Workspace totals</h2></div></div><dl className="health-list"><div><dt>Agents</dt><dd>{data.metrics.agents}</dd></div><div><dt>Evaluations</dt><dd>{data.metrics.evaluations}</dd></div><div><dt>Audit events</dt><dd>{data.metrics.auditEvents}</dd></div><div><dt>Workspace</dt><dd>{data.workspace.name}</dd></div></dl><Link href="/agents">View rollout status <ArrowRight size={13} /></Link></aside></div>
  </>;
}
