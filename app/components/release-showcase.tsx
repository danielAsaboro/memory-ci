"use client";

import { Activity, Bot, Check, Cloud, Database, Pause, Play, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getIntegrationStatus } from "../lib/api-client";

const stages = [
  { name: "Proposed", detail: "Candidate digest recorded", event: "Candidate created from verified source", icon: Activity },
  { name: "Screened", detail: "Poisoning scan complete", event: "Instruction-scope checks returned no blockers", icon: ShieldCheck },
  { name: "Evaluated", detail: "Behavioral evidence attached", event: "Eight recorded scenarios reached a conclusive result", icon: ScanSearch },
  { name: "Ready to promote", detail: "Review binds this digest", event: "Approval is ready for an atomic revision commit", icon: Check },
] as const;

const changes = [
  ["High-value refund escalation", "Evaluation complete", "Ready to review", "blue"],
  ["Customer locale preference", "Policy screen passed", "Approved", "green"],
  ["VIP override instruction", "Poisoning detected", "Quarantined", "orange"],
  ["Knowledge-base sync", "Evidence gathering", "In review", "purple"],
] as const;

const serviceIcons = { cockroach: Database, aws: Cloud, agent: Bot };

export function ReleaseShowcase() {
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const status = useQuery({ queryKey: ["landing-integration-status"], queryFn: getIntegrationStatus, refetchInterval: 15_000 });
  const current = stages[stage];

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setStage((value) => (value + 1) % stages.length), 2_700);
    return () => window.clearInterval(timer);
  }, [paused]);

  return <section className="release-showcase" aria-label="Interactive product walkthrough">
    <div className="showcase-heading"><div><p>Interactive release walkthrough</p><h2>See a change earn its way to production.</h2></div><div className="showcase-controls"><button onClick={() => setPaused((value) => !value)} aria-label={paused ? "Resume release activity" : "Pause release activity"}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "Resume" : "Pause"}</button><button onClick={() => { setStage(0); setPaused(false); }} aria-label="Restart release activity"><RefreshCw size={14} /> Restart</button></div></div>
    <div className="showcase-grid">
      <div className="stage-story"><div className="stage-index">0{stage + 1} / 04</div><current.icon size={28} /><p className="stage-overline">{current.name}</p><h3>{current.detail}</h3><span>{current.event}</span><div className="stage-progress"><i style={{ width: `${((stage + 1) / stages.length) * 100}%` }} /></div><small>{paused ? "Walkthrough paused" : "Advancing automatically"}</small></div>
      <div className="showcase-queue"><div className="queue-top"><span><i /><i /><i /></span><strong>Memory release queue</strong><b>{paused ? "PAUSED" : "RUNNING"}</b></div><div className="queue-tabs"><span>Changes</span><span>Evidence</span><span>Lineage</span><em>{String(stage + 1).padStart(2, "0")}</em></div>{changes.map(([title, detail, state, tone], index) => <article key={title} className={index === stage ? "queue-active" : ""}><span className={`change-icon ${tone}`}><Activity size={14} /></span><div><strong>{title}</strong><small>{index === stage ? current.event : detail}</small></div><em className={index === stage ? "pink" : tone}>{index === stage ? current.name : state}</em></article>)}<div className="queue-footer"><span><Check size={13} /> Retrieval only sees committed revisions</span><b>r184</b></div></div>
    </div>
    <div className="runtime-status"><div><p>Runtime status</p><span>{status.isLoading ? "Checking configured services…" : status.isError ? "Integration status unavailable" : status.data?.demoMode ? "Local development status" : "Live integration status"}</span></div>{status.data ? <ul>{Object.entries(status.data.status).map(([name, service]) => { const Icon = serviceIcons[name as keyof typeof serviceIcons]; return <li key={name}><Icon size={15} /><span><b>{name === "cockroach" ? "CockroachDB" : name === "aws" ? "AWS execution plane" : "Agent runtime"}</b><small>{service.detail}</small></span><em className={service.state}>{service.state}</em></li>; })}</ul> : <button onClick={() => status.refetch()}><RefreshCw size={14} /> Retry status</button>}</div>
  </section>;
}
