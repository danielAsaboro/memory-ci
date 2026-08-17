"use client";
import { useQuery } from "@tanstack/react-query";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { MemoryExplorer } from "../components/memory-explorer";
import { getMemories, queryKeys } from "../lib/api-client";
export default function MemoryPage() { return <WorkspaceBoundary>{(workspaceId) => <Memory workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Memory({ workspaceId }: { workspaceId: string }) { const query = useQuery({ queryKey: queryKeys.memories(workspaceId), queryFn: getMemories }); if (query.isError) return <TerminalError title="Memory data is unavailable" error={query.error} onRetry={() => query.refetch()} />; if (query.isLoading || !query.data) return <AsyncSkeleton label="Loading committed memory" />; return <><div className="page-header"><div><span className="eyebrow">System of record</span><h1>Memory explorer</h1><p>Committed memory is revision-bound and attributable.</p></div></div><MemoryExplorer memories={query.data} /></>; }
