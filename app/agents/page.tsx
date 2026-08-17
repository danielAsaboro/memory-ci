"use client";
import { useQuery } from "@tanstack/react-query";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { AgentRolloutTable } from "../components/agent-rollout-table";
import { getAgents, queryKeys } from "../lib/api-client";
export default function AgentsPage() { return <WorkspaceBoundary>{(workspaceId) => <Agents workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Agents({ workspaceId }: { workspaceId: string }) { const query = useQuery({ queryKey: queryKeys.agents(workspaceId), queryFn: getAgents }); if (query.isError) return <TerminalError title="Agent data is unavailable" error={query.error} onRetry={() => query.refetch()} />; if (query.isLoading || !query.data) return <AsyncSkeleton label="Loading registered agents" />; return <><div className="page-header"><div><span className="eyebrow">Revision consumers</span><h1>Agents</h1><p>Read receipts show which agents have consumed workspace memory.</p></div><button className="button secondary" disabled title="Agent registration will be available with lifecycle operations">Register agent</button></div><AgentRolloutTable agents={query.data} /></>; }
