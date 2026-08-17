"use client";
import { useQuery } from "@tanstack/react-query";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { AuditTimeline } from "../components/audit-timeline";
import { getAuditEvents, queryKeys } from "../lib/api-client";
export default function AuditPage() { return <WorkspaceBoundary>{(workspaceId) => <Audit workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Audit({ workspaceId }: { workspaceId: string }) { const query = useQuery({ queryKey: queryKeys.audit(workspaceId), queryFn: getAuditEvents }); if (query.isError) return <TerminalError title="Audit data is unavailable" error={query.error} onRetry={() => query.refetch()} />; if (query.isLoading || !query.data) return <AsyncSkeleton label="Loading audit events" />; return <><div className="page-header"><div><span className="eyebrow">Verifiable operations</span><h1>Audit trail</h1><p>Application actions and provider receipts are shown as returned by the workspace.</p></div></div><AuditTimeline events={query.data} /></>; }
