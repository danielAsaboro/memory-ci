"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { StashApiError } from "../lib/api-client";
import { useWorkspace } from "../lib/workspace-provider";

export function WorkspaceBoundary({ children }: { children: (workspaceId: string) => ReactNode }) {
  const { workspace, state, error, retry } = useWorkspace();
  if (state === "loading") return <AsyncSkeleton label="Connecting to the workspace" />;
  if (state === "error" || !workspace) return <TerminalError title="Workspace unavailable" error={error} onRetry={retry} />;
  return <>{children(workspace.tenantId)}</>;
}

export function AsyncSkeleton({ label = "Loading live workspace data" }: { label?: string }) {
  return <section className="empty-panel" aria-busy="true" aria-live="polite"><div className="spin" aria-hidden="true"><RefreshCw /></div><h2>{label}</h2><p>The console is waiting for a verified response.</p></section>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <section className="empty-panel"><h2>{title}</h2><p>{detail}</p>{action ? <div>{action}</div> : null}</section>;
}

export function TerminalError({ title, error, onRetry }: { title: string; error: unknown; onRetry?: () => void }) {
  const requestId = error instanceof StashApiError ? error.requestId : "unknown";
  const message = error instanceof StashApiError ? error.message : "The live data could not be loaded.";
  return <section className="empty-panel error-panel" role="alert"><AlertTriangle aria-hidden="true" /><h2>{title}</h2><p>{message} Request ID: {requestId}</p>{onRetry ? <button className="button secondary" onClick={onRetry}><RefreshCw size={14} />Try again</button> : null}</section>;
}

export function ProviderDegraded({ detail }: { detail: string }) {
  return <div className="sandbox-banner provider-degraded" role="status"><AlertTriangle size={14} aria-hidden="true" /><span>Provider attention required</span> {detail}</div>;
}
