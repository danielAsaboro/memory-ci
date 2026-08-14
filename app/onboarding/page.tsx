"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, RotateCw } from "lucide-react";
import Link from "next/link";

import { OnboardingChecklist } from "../components/onboarding-checklist";
import { getIntegrationStatus } from "../lib/api-client";

export default function OnboardingPage() {
  const query = useQuery({ queryKey: ["integration-status"], queryFn: getIntegrationStatus });
  return <>
    <div className="page-header wide-header">
      <div><span className="eyebrow">First run</span><h1>Make memory deployable.</h1><p>Connect the database, verify AWS, then register one agent. Every green state must have evidence behind it.</p></div>
      <Link href="/changes" className="button primary">Open review queue <ArrowRight size={15} /></Link>
    </div>
    {query.isLoading ? <div className="empty-panel"><RotateCw className="spin" /><h2>Checking integrations</h2><p>No success state is shown until each provider responds.</p></div> : null}
    {query.isError ? <div className="empty-panel error-panel"><h2>Integration status unavailable</h2><p>{query.error.message}</p><button className="button secondary" onClick={() => query.refetch()}>Try again</button></div> : null}
    {query.data ? <OnboardingChecklist demoMode={query.data.demoMode} status={query.data.status} onRetry={() => query.refetch()} /> : null}
    <div className="help-strip"><BookOpen size={18} /><div><strong>What gets stored?</strong><p>Candidate payloads, provenance, evaluations, approvals, immutable versions, activation events, and read receipts.</p></div><Link href="/memory">Explore the model <ArrowRight size={14} /></Link></div>
  </>;
}
