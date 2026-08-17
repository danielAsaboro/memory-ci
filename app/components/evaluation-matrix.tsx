import { Check, CircleAlert } from "lucide-react";

import type { EvaluationDetail } from "../../src/contracts/dashboard";
import { EmptyState } from "./async-state";

export function EvaluationMatrix({ evaluations }: { evaluations: EvaluationDetail[] }) {
  const results = evaluations.flatMap((evaluation) => evaluation.results.map((result) => ({ evaluation, result })));
  return <section className="panel">
    <div className="panel-heading"><div><span className="eyebrow">Counterfactual suite</span><h2>Scenario matrix</h2></div><span className={results.length > 0 && !results.some(({ result }) => result.status === "failed" || result.status === "regressed") ? "readiness complete" : "readiness"}>{results.length} result{results.length === 1 ? "" : "s"}</span></div>
    {/* A horizontally scrollable data region must be keyboard focusable. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="evaluation-table" tabIndex={0} aria-label="Evaluation scenarios; scroll horizontally for all columns">
      <div className="evaluation-row evaluation-header"><span>Scenario</span><span>Baseline</span><span>Candidate</span><span>Result</span><span>Provider receipt</span></div>
      {results.map(({ evaluation, result }) => <div className="evaluation-row" key={result.id}><span><strong>{result.scenarioName}</strong></span><span>r{evaluation.baselineRevision}</span><span><code>{evaluation.candidateId}</code></span><span className={result.status === "passed" ? "passed-cell" : "expected-delta"}>{result.status === "passed" ? <Check size={13} /> : <CircleAlert size={13} />}{result.status}</span><span>{result.providerRequestId ?? "No provider receipt"}</span></div>)}
      {!results.length ? <EmptyState title="No evaluation runs are available" detail="Run results will appear after the provider returns a receipt." /> : null}
    </div>
  </section>;
}
