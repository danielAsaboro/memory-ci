"use client";

import { Check, ShieldX, X } from "lucide-react";
import { useState } from "react";

export function ReviewActions({ blocked = false }: { blocked?: boolean }) {
  const [decision, setDecision] = useState<string | null>(null);
  return <div className="review-actions"><div><strong>{blocked ? "Promotion blocked" : "Evidence is ready"}</strong><small>{blocked ? "Critical policy controls require quarantine." : "Approval binds this digest, evaluation, revision, and policy version."}</small></div>
    <button className="button subtle" onClick={() => setDecision("rejected")}><X size={14} />Reject</button>
    <button className="button danger-button" onClick={() => setDecision("quarantined")}><ShieldX size={14} />Quarantine</button>
    <button className="button primary" disabled={blocked} aria-disabled={blocked} onClick={() => setDecision("approved")}><Check size={14} />Approve</button>
    <span className="sr-only" role="status">{decision ? `Candidate ${decision}` : ""}</span>
  </div>;
}
