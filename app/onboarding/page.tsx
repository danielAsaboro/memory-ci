"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen } from "lucide-react";

import { OnboardingChecklist } from "../components/onboarding-checklist";
import { AsyncSkeleton, TerminalError, WorkspaceBoundary } from "../components/async-state";
import { getWorkspaceStatus, queryKeys } from "../lib/api-client";

export default function OnboardingPage() { return <WorkspaceBoundary>{(workspaceId) => <Onboarding workspaceId={workspaceId} />}</WorkspaceBoundary>; }
function Onboarding({ workspaceId }: { workspaceId: string }) {
  const query = useQuery({ queryKey: queryKeys.status(workspaceId), queryFn: getWorkspaceStatus });
  return <>
    <div className="page-header wide-header">
      <div><span className="eyebrow">First run</span><h1>Make memory deployable.</h1><p>Connect the database, verify AWS, then register one agent. Every green state must have evidence behind it.</p></div>
      {/* Native navigation avoids an App Router transition race on the first-run route. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/changes" className="button primary">Open review queue <ArrowRight size={15} /></a>
    </div>
    {query.isLoading ? <AsyncSkeleton label="Checking integrations" /> : null}
    {query.isError ? <TerminalError title="Integration status unavailable" error={query.error} onRetry={() => query.refetch()} /> : null}
    {query.data ? <OnboardingChecklist status={query.data.integrations} onRetry={() => query.refetch()} /> : null}
    <div className="help-strip">
      <BookOpen size={18} />
      <div><strong>What gets stored?</strong><p>Candidate payloads, provenance, evaluations, approvals, immutable versions, activation events, and read receipts.</p></div>
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/memory">Explore the model <ArrowRight size={14} /></a>
    </div>
  </>;
}
