"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Play, ShieldX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { CandidateSummary, EvaluationSummary } from "../../src/contracts/dashboard";
import { getEvaluation, getEvaluations, promoteCandidate, queryKeys, requestEvaluation, screenCandidate, submitReview } from "../lib/api-client";

const terminal = new Set(["passed", "regressed", "inconclusive", "failed"]);
const delays = [1_000, 2_000, 4_000] as const;

type Props = { workspaceId?: string; candidate?: CandidateSummary; evaluation?: EvaluationSummary | null; blocked?: boolean };

export function ReviewActions(props: Props) {
  if (!props.candidate) return <section className="review-actions"><div><strong>Promotion blocked</strong><small>Approval requires live evaluation evidence.</small></div><button className="button subtle" disabled><X size={14} />Reject</button><button className="button danger-button" disabled><ShieldX size={14} />Quarantine</button><button className="button primary" disabled={props.blocked ?? true}><Check size={14} />Approve</button></section>;
  return <LiveReviewActions {...props} candidate={props.candidate} />;
}

function LiveReviewActions({ workspaceId, candidate, evaluation, blocked: forcedBlocked }: Props & { candidate: CandidateSummary }) {
  const scopedWorkspace = workspaceId ?? "legacy";
  const client = useQueryClient();
  const [reason, setReason] = useState(""); const [stableKey, setStableKey] = useState(""); const [notice, setNotice] = useState<string | null>(null);
  const [polled, setPolled] = useState<EvaluationSummary | null>(evaluation ?? null); const [evaluationId, setEvaluationId] = useState<string | null>(evaluation?.id ?? null); const [reviewId, setReviewId] = useState<string | null>(null);
  const screenKey = useRef<string | null>(null); const evaluateKey = useRef<string | null>(null); const reviewKey = useRef<string | null>(null); const promoteKey = useRef<string | null>(null);
  const idempotencyKey = (reference: MutableRefObject<string | null>) => reference.current ??= crypto.randomUUID();
  const invalidate = useCallback(async () => { await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.candidate(scopedWorkspace, candidate.id) }), client.invalidateQueries({ queryKey: queryKeys.candidates(scopedWorkspace) }),
    client.invalidateQueries({ queryKey: queryKeys.evaluations(scopedWorkspace) }), client.invalidateQueries({ queryKey: queryKeys.memories(scopedWorkspace) }),
    client.invalidateQueries({ queryKey: queryKeys.overview(scopedWorkspace) }), client.invalidateQueries({ queryKey: queryKeys.audit(scopedWorkspace) }),
  ]); }, [candidate.id, client, scopedWorkspace]);
  const currentEvidence = polled ?? evaluation;
  const blocked = Boolean(forcedBlocked) || candidate.state === "quarantined" || candidate.blockingFindingCount > 0 || !currentEvidence || currentEvidence.status !== "passed" || !currentEvidence.completedAt;
  const screen = useMutation({ mutationFn: () => screenCandidate(candidate.id, idempotencyKey(screenKey)), onSuccess: async (receipt) => { setNotice(`Screened ${receipt.candidateId}: ${receipt.state}.`); await invalidate(); } });
  const evaluate = useMutation({ mutationFn: () => requestEvaluation(candidate.id, idempotencyKey(evaluateKey)), onSuccess: () => { setNotice("Evaluation queued. Waiting for evidence receipt."); void invalidate(); } });
  const review = useMutation({ mutationFn: (decision: "approved" | "rejected" | "quarantined") => submitReview(candidate.id, { evaluationRunId: evaluation!.id, decision, reason }, idempotencyKey(reviewKey)), onSuccess: async (receipt) => { setReviewId(receipt.reviewId); setNotice(`Review ${receipt.decision}; request ${receipt.reviewId}.`); await invalidate(); } });
  const promote = useMutation({ mutationFn: () => promoteCandidate(candidate.id, { reviewId: reviewId!, stableKey, reason }, idempotencyKey(promoteKey)), onSuccess: async (receipt) => { setNotice(`Active memory revision ${receipt.revision}; version ${receipt.version}.`); await invalidate(); } });
  useEffect(() => {
    if (!evaluate.isSuccess || terminal.has(polled?.status ?? "")) return;
    let active = true; let attempt = 0; const started = Date.now(); let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => { try {
      if (!evaluationId) { const found = (await getEvaluations()).find((item) => item.candidateId === candidate.id); if (!active) return; if (found) setEvaluationId(found.id); else { timer = setTimeout(poll, delays[attempt++] ?? 5_000); return; } }
      const result = await getEvaluation(evaluationId ?? evaluation!.id); if (!active) return; setPolled(result);
      if (terminal.has(result.status)) { setNotice(`Evaluation ${result.status}${result.providerRequestId ? `; provider request ${result.providerRequestId}` : ""}.`); await invalidate(); return; }
      if (Date.now() - started >= 90_000) { setNotice("Evaluation is still running. Refresh later to continue monitoring."); return; }
      timer = setTimeout(poll, delays[attempt++] ?? 5_000);
    } catch { if (active) setNotice("Evaluation progress is unavailable. Refresh to retry."); } };
    timer = setTimeout(poll, delays[attempt++] ?? 1_000); return () => { active = false; if (timer) clearTimeout(timer); };
  }, [candidate.id, evaluate.isSuccess, evaluation, evaluationId, invalidate, polled?.status]);
  const runAvailable = candidate.state === "evaluating";
  const canReview = candidate.state === "review_required" && Boolean(evaluation);
  return <section className="review-actions"><div><strong>{blocked ? "Promotion blocked" : "Evaluation evidence passed"}</strong><small>{blocked ? "Approval requires passed, current, non-quarantined evidence." : "Review is bound to the completed evaluation run."}</small>{notice ? <small role="status">{notice}</small> : null}</div>
    {candidate.state === "proposed" ? <button className="button primary" onClick={() => screen.mutate()} disabled={screen.isPending}>Screen candidate</button> : null}
    {runAvailable ? <button className="button primary" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}><Play size={14} />Run evaluation</button> : null}
    <label>Review reason<input aria-label="Review reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <button className="button subtle" disabled={!canReview || !reason || review.isPending} onClick={() => review.mutate("rejected")}><X size={14} />Reject</button><button className="button danger-button" disabled={!canReview || !reason || review.isPending} onClick={() => review.mutate("quarantined")}><ShieldX size={14} />Quarantine</button><button className="button primary" disabled={!canReview || blocked || !reason || review.isPending} onClick={() => review.mutate("approved")}><Check size={14} />Approve</button>
    {candidate.state === "approved" ? <><label>Stable key<input aria-label="Stable key" value={stableKey} onChange={(event) => setStableKey(event.target.value)} /></label><button className="button primary" disabled={!reviewId || !stableKey || !reason || promote.isPending} onClick={() => promote.mutate()}>Promote</button></> : null}
  </section>;
}
