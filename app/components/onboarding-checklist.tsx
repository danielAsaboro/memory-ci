"use client";

import { Check, Clipboard, Cloud, Database, LoaderCircle, RefreshCw, TerminalSquare } from "lucide-react";
import { useState } from "react";

import type { IntegrationStatus } from "../lib/api-client";

const config = `{
  "mcpServers": {
    "cockroachdb": {
      "url": "https://cockroachlabs.cloud/mcp",
      "mode": "read-only"
    }
  }
}`;

export function OnboardingChecklist({ status, onRetry }: {
  status: IntegrationStatus; onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ready = Object.values(status).filter((item) => item.state === "ready").length;
  const items = [
    { id: "cockroach" as const, title: "Connect the memory plane", description: "CockroachDB stores candidates, vectors, revisions, and the audit chain.", icon: Database },
    { id: "aws" as const, title: "Verify the execution plane", description: "Bedrock, S3, EventBridge, and Lambda return provider receipts.", icon: Cloud },
    { id: "agent" as const, title: "Register an agent", description: "Give one agent revision-aware reads and a read-only MCP auditor.", icon: TerminalSquare },
  ];
  return <section className="onboarding-card" aria-labelledby="setup-title">
    <div className="card-heading">
      <div><span className="eyebrow">Workspace readiness</span><h2 id="setup-title">Ship governed memory</h2></div>
      <span className={ready === 3 ? "readiness complete" : "readiness"}>{ready === 3 ? "Setup complete" : `${ready} of 3 ready`}</span>
    </div>
    <ol className="setup-list">
      {items.map(({ id, title, description, icon: Icon }, index) => {
        const item = status[id];
        return <li key={id} className="setup-item">
          <span className={`step-icon ${item.state}`} aria-hidden="true">{item.state === "ready" ? <Check size={17} /> : item.state === "loading" ? <LoaderCircle className="spin" size={17} /> : <Icon size={17} />}</span>
          <div className="step-copy"><span className="step-number">0{index + 1}</span><h3>{title}</h3><p>{description}</p><small>{item.detail}</small></div>
          {item.state === "blocked" ? <span className="state-label danger">Action required</span> : null}
          {item.state === "unavailable" ? <button className="button subtle" onClick={onRetry} aria-label={`Retry ${id === "cockroach" ? "CockroachDB" : id}`}><RefreshCw size={14} /> Retry</button> : null}
        </li>;
      })}
    </ol>
    <div className="config-block">
      <div><span className="eyebrow">Read-only auditor config</span><p>Paste this into Claude, Cursor, or VS Code after issuing a scoped token.</p></div>
      <pre>{config}</pre>
      <button className="button secondary" aria-label="Copy agent configuration" onClick={async () => { await navigator.clipboard.writeText(config); setCopied(true); }}><Clipboard size={15} />Copy config</button>
      <span className="sr-only" role="status">{copied ? "Configuration copied" : ""}</span>
    </div>
  </section>;
}
