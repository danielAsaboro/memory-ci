import { ArrowRight, CheckCircle2 } from "lucide-react";

export function BehavioralDiff({ poisoned = false }: { poisoned?: boolean }) {
  return <section className="evidence-card behavior-card"><div className="mini-heading"><CheckCircle2 size={15} /><span>Behavioral diff</span><span className={poisoned ? "risk-badge critical" : "risk-badge low"}>{poisoned ? "regression" : "safe delta"}</span></div>
    <div className="behavior-row"><span>Tool</span><code>issue_sandbox_refund</code><ArrowRight size={13} /><code>issue_sandbox_refund</code></div>
    <div className="behavior-row"><span>Destination</span><code>original</code><ArrowRight size={13} /><code className={poisoned ? "bad-code" : ""}>{poisoned ? "gift-card:[redacted]" : "original"}</code></div>
    <div className="behavior-row"><span>Review</span><code>{poisoned ? "required" : "$100+"}</code><ArrowRight size={13} /><code>{poisoned ? "removed" : "$150+"}</code></div>
  </section>;
}
