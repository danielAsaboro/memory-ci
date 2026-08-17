"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { ChangeQueue } from "../components/change-queue";
import { ProposeMemoryDialog } from "../components/propose-memory-dialog";
import { getCandidates, queryKeys } from "../lib/api-client";
export default function ChangesPage() { return <WorkspaceBoundary>{(workspaceId) => <Changes workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Changes({ workspaceId }: { workspaceId: string }) { const [open, setOpen] = useState(false); const query = useQuery({ queryKey: queryKeys.candidates(workspaceId), queryFn: getCandidates }); if (query.isError) return <TerminalError title="Candidate queue is unavailable" error={query.error} onRetry={() => query.refetch()} />; if (query.isLoading || !query.data) return <AsyncSkeleton label="Loading candidate queue" />; return <><div className="page-header"><div><span className="eyebrow">Release queue</span><h1>Memory changes</h1><p>Review provider-backed provenance and evaluation evidence before activation.</p></div><button className="button secondary" onClick={() => setOpen(true)}>Propose memory</button></div><ChangeQueue candidates={query.data} />{open ? <ProposeMemoryDialog workspaceId={workspaceId} onClose={() => setOpen(false)} /> : null}</>; }
