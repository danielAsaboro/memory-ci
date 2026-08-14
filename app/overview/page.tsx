import { ArrowRight, Bot, GitPullRequestArrow, ShieldAlert, TimerReset } from "lucide-react";
import Link from "next/link";

import { ChangeQueue } from "../components/change-queue";
import { MetricCard } from "../components/metric-card";

export default function OverviewPage() {
  return <><div className="page-header"><div><span className="eyebrow">Memory control plane</span><h1>Good morning, Amina.</h1><p>Three memory changes need attention. No unreviewed policy is active.</p></div><Link href="/changes/chg-threshold-150" className="button primary">Review next change <ArrowRight size={15} /></Link></div>
    <div className="metric-grid"><MetricCard label="Open changes" value="3" detail="1 critical quarantined" icon={GitPullRequestArrow} tone="cobalt" /><MetricCard label="Active memories" value="42" detail="Across 3 namespaces" icon={Bot} /><MetricCard label="Regressions blocked" value="17" detail="Past 30 days" icon={ShieldAlert} tone="red" /><MetricCard label="Median evaluation" value="14.2s" detail="12 scenario suite" icon={TimerReset} /></div>
    <div className="overview-grid"><ChangeQueue /><aside className="panel activity-panel"><div className="panel-heading"><div><span className="eyebrow">Live controls</span><h2>Release health</h2></div></div><div className="health-score"><strong>98.7%</strong><span>evaluation pass rate</span></div><div className="health-bars"><span style={{width:"98.7%"}} /></div><dl className="health-list"><div><dt>Current revision</dt><dd>12</dd></div><div><dt>Agents converged</dt><dd>8 / 8</dd></div><div><dt>Vector indexes</dt><dd className="good-text">Online</dd></div><div><dt>Audit chain</dt><dd className="good-text">Verified</dd></div></dl><Link href="/agents">View rollout status <ArrowRight size={13} /></Link></aside></div>
  </>;
}
