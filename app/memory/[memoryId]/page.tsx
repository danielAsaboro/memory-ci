"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Braces } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../../components/async-state";
import { LineageTimeline } from "../../components/lineage-timeline";
import { getMemory, queryKeys } from "../../lib/api-client";
export default function MemoryDetailPage() { const params = useParams<{ memoryId: string }>(); return <WorkspaceBoundary>{(workspaceId) => <MemoryDetail workspaceId={workspaceId} memoryId={params.memoryId} />}</WorkspaceBoundary>; }
function MemoryDetail({ workspaceId, memoryId }: { workspaceId: string; memoryId: string }) { const query = useQuery({ queryKey: queryKeys.memory(workspaceId, memoryId), queryFn: () => getMemory(memoryId) }); if (query.isError) return <TerminalError title="Memory record is unavailable" error={query.error} onRetry={() => query.refetch()} />; if (query.isLoading || !query.data) return <AsyncSkeleton label="Loading memory record" />; const memory = query.data; return <><Link href="/memory" className="back-link"><ArrowLeft size={14} />Back to memory</Link><div className="change-hero"><div><div className="change-meta"><span className={`risk-badge ${memory.active ? "low" : "medium"}`}>{memory.active ? "active" : "inactive"}</span><span>{memory.namespaceName}</span><span>{memory.memoryClass}</span></div><h1>{memory.stableKey}</h1><p>Serving at revision {memory.revision}.</p></div><div className="change-id"><small>Current version</small><strong>v{memory.version}</strong><small>Reads</small><strong>{memory.reads}</strong></div></div><div className="memory-detail-grid"><LineageTimeline lineage={memory.lineage} /><div className="detail-stack"><section className="evidence-card"><div className="mini-heading"><Braces size={15} />Canonical payload</div><pre className="payload-block">{memory.canonicalText}</pre></section></div></div></>; }
