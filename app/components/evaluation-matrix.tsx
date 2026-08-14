import { Check, GitCompareArrows } from "lucide-react";

import { scenarios } from "../lib/demo-data";

export function EvaluationMatrix() {
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Counterfactual suite</span><h2>Scenario matrix</h2></div><span className="readiness complete">5 / 5 conclusive</span></div>
    {/* A horizontally scrollable data region must be keyboard focusable. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="evaluation-table" tabIndex={0} aria-label="Evaluation scenarios; scroll horizontally for all columns">
      <div className="evaluation-row evaluation-header"><span>Scenario</span><span>Baseline r11</span><span>Candidate</span><span>Result</span><span>Latency</span></div>
      {scenarios.map((scenario) => <div className="evaluation-row" key={scenario.name}><span><strong>{scenario.name}</strong></span><span>{scenario.baseline}</span><span>{scenario.candidate}</span><span className={scenario.status === "changed" ? "expected-delta" : "passed-cell"}>{scenario.status === "changed" ? <GitCompareArrows size={13} /> : <Check size={13} />}{scenario.status === "changed" ? "Expected delta" : "Passed"}</span><span>{scenario.duration}</span></div>)}
    </div>
  </section>;
}
