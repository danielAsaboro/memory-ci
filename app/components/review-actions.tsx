"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Play, ShieldX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

import type { CandidateSummary, EvaluationSummary } from "../../src/contracts/dashboard";
import { getEvaluation, getEvaluations, promoteCandidate, queryKeys, requestEvaluation, screenCandidate, StashApiError, submitReview } from "../lib/api-client";
import { retryFingerprint } from "../lib/retry-fingerprint";

const terminal = new Set(["passed", "regressed", "inconclusive", "failed"]);
const delays = [1_000, 2_000, 4_000] as const;
const errorNotice = (error: unknown, fallback: string) => error instanceof StashApiError
  ? `${error.message} Request ID: ${error.requestId}.`
  : error instanceof Error ? error.message : fallback;

type Props = { workspaceId?: string; candidate?: CandidateSummary; evaluation?: EvaluationSummary | null; blocked?: boolean };

export function ReviewActions(props: Props) {
  if (!props.candidate) return <section className="review-actions"><div><strong>Promotion blocked</strong><small>Approval requires live evaluation evidence.</small></div><button className="button subtle" disabled><X size={14} />Reject</button><button className="button danger-button" disabled><ShieldX size={14} />Quarantine</button><button className="button primary" disabled={props.blocked ?? true}><Check size={14} />Approve</button></section>;
  return <LiveReviewActions key={props.candidate.id} {...props} candidate={props.candidate} />;
}

function LiveReviewActions({ workspaceId, candidate, evaluation, blocked: forcedBlocked }: Props & { candidate: CandidateSummary }) {
  const scopedWorkspace = workspaceId ?? "legacy";
  const client = useQueryClient();
  const [reason, setReason] = useState(""); const [stableKey, setStableKey] = useState(""); const [notice, setNotice] = useState<string | null>(null);
  const authoritativeEvaluationId = candidate.latestEvaluationId ?? evaluation?.id ?? null;
  const authoritativeEvaluation = evaluation?.id === authoritativeEvaluationId ? evaluation : null;
  const [polled, setPolled] = useState<EvaluationSummary | null>(null); const [evaluationId, setEvaluationId] = useState<string | null>(null); const [evaluationRequestBaseline, setEvaluationRequestBaseline] = useState<{ id: string | null } | null>(null);
  const [submittedReviewId, setSubmittedReviewId] = useState<string | null>(null); const [staleReviewId, setStaleReviewId] = useState<string | null>(null);
  const screenKey = useRef<string | null>(null); const evaluateKey = useRef<string | null>(null); const reviewKey = useRef<string | null>(null); const promoteKey = useRef<string | null>(null);
  const reviewFingerprint = useRef<string | null>(null); const promoteFingerprint = useRef<string | null>(null);
  const pollDeadline = useRef<{ candidateId: string; evaluationId: string | null; deadline: number } | null>(null);
  const idempotencyKey = (reference: MutableRefObject<string | null>) => reference.current ??= crypto.randomUUID();
  const keyedFor = (key: MutableRefObject<string | null>, fingerprint: MutableRefObject<string | null>, value: string) => { if (fingerprint.current !== value) { fingerprint.current = value; key.current = null; } return idempotencyKey(key); };
  const invalidate = useCallback(async (refetch = false) => { await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.candidate(scopedWorkspace, candidate.id) }), client.invalidateQueries({ queryKey: queryKeys.candidates(scopedWorkspace) }),
    client.invalidateQueries({ queryKey: queryKeys.evaluations(scopedWorkspace) }), client.invalidateQueries({ queryKey: queryKeys.memories(scopedWorkspace) }),
    client.invalidateQueries({ queryKey: queryKeys.overview(scopedWorkspace) }), client.invalidateQueries({ queryKey: queryKeys.audit(scopedWorkspace) }),
    client.invalidateQueries({ queryKey: queryKeys.namespaceEvidence(scopedWorkspace, candidate.namespaceId) }),
  ]); if (refetch) await Promise.all([
    client.refetchQueries({ queryKey: queryKeys.candidate(scopedWorkspace, candidate.id), type: "active" }),
    client.refetchQueries({ queryKey: queryKeys.evaluations(scopedWorkspace), type: "active" }),
  ]); }, [candidate.id, candidate.namespaceId, client, scopedWorkspace]);
  const awaitingNewEvaluation = evaluationRequestBaseline !== null && evaluationRequestBaseline.id === authoritativeEvaluationId;
  const effectiveEvaluationId = awaitingNewEvaluation ? evaluationId : authoritativeEvaluationId ?? evaluationId;
  const currentEvidence = awaitingNewEvaluation ? (polled?.id === effectiveEvaluationId ? polled : null) : authoritativeEvaluation ?? (polled?.id === effectiveEvaluationId ? polled : null);
  const currentEvidenceStatus = currentEvidence?.status;
  const reviewId = candidate.latestApprovedReviewId && candidate.latestApprovedReviewId !== staleReviewId ? candidate.latestApprovedReviewId : submittedReviewId;
  const blocked = Boolean(forcedBlocked) || candidate.state === "quarantined" || candidate.blockingFindingCount > 0 || !currentEvidence || currentEvidence.status !== "passed" || !currentEvidence.completedAt;
  const screen = useMutation({ mutationFn: () => screenCandidate(candidate.id, idempotencyKey(screenKey)), onSuccess: async (receipt) => { setNotice(`Screened ${receipt.candidateId}: ${receipt.state}.`); await invalidate(); }, onError: (error) => setNotice(errorNotice(error, "Screening is unavailable.")) });
  const evaluate = useMutation({ mutationFn: () => { pollDeadline.current = { candidateId: candidate.id, evaluationId: null, deadline: Date.now() + 90_000 }; return requestEvaluation(candidate.id, idempotencyKey(evaluateKey)); }, onSuccess: () => { setEvaluationRequestBaseline({ id: authoritativeEvaluationId }); setEvaluationId(null); setPolled(null); setNotice("Evaluation queued. Waiting for evidence receipt."); void invalidate(); }, onError: (error) => { pollDeadline.current = null; setNotice(errorNotice(error, "Evaluation is unavailable.")); } });
  const recoverStaleReview = () => { setSubmittedReviewId(null); setStaleReviewId(candidate.latestApprovedReviewId); reviewKey.current = null; promoteKey.current = null; setNotice("The review evidence is stale. Request a new review after evidence refreshes."); void invalidate(true); };
  const review = useMutation({ mutationFn: (decision: "approved" | "rejected" | "quarantined") => { const input = { evaluationRunId: effectiveEvaluationId ?? currentEvidence!.id, decision, reason }; return submitReview(candidate.id, input, keyedFor(reviewKey, reviewFingerprint, retryFingerprint(input))); }, onSuccess: async (receipt) => { setSubmittedReviewId(receipt.reviewId); setStaleReviewId(null); setNotice(`Review ${receipt.decision}; request ${receipt.reviewId}.`); await invalidate(); }, onError: (error) => { if (error instanceof StashApiError && error.code === "stale_review") recoverStaleReview(); else setNotice(errorNotice(error, "Review is unavailable.")); } });
  const promote = useMutation({ mutationFn: () => { const input = { reviewId: reviewId!, stableKey, reason }; return promoteCandidate(candidate.id, input, keyedFor(promoteKey, promoteFingerprint, retryFingerprint(input))); }, onSuccess: async (receipt) => { setNotice(`Active memory revision ${receipt.revision}; version ${receipt.version}.`); await invalidate(); }, onError: (error) => { if (error instanceof StashApiError && error.code === "stale_review") recoverStaleReview(); else setNotice(errorNotice(error, "Promotion is unavailable.")); } });
  useEffect(() => {
    const activeDeadline = pollDeadline.current;
    if (candidate.state !== "evaluating" && authoritativeEvaluation && terminal.has(authoritativeEvaluation.status)) {
      pollDeadline.current = null;
    } else if (activeDeadline && activeDeadline.candidateId === candidate.id) {
      if (activeDeadline.evaluationId && authoritativeEvaluationId && activeDeadline.evaluationId !== authoritativeEvaluationId) {
        pollDeadline.current = { candidateId: candidate.id, evaluationId: authoritativeEvaluationId, deadline: Date.now() + 90_000 };
      } else if (!activeDeadline.evaluationId && authoritativeEvaluationId) {
        activeDeadline.evaluationId = authoritativeEvaluationId;
      }
    }
  }, [authoritativeEvaluation, authoritativeEvaluationId, candidate.id, candidate.state]);
  useEffect(() => {
    if (!(evaluate.isSuccess || candidate.state === "evaluating") || (currentEvidenceStatus && !["pending", "running"].includes(currentEvidenceStatus))) return;
    let activeDeadline = pollDeadline.current;
    if (!activeDeadline || activeDeadline.candidateId !== candidate.id) {
      activeDeadline = { candidateId: candidate.id, evaluationId: effectiveEvaluationId, deadline: Date.now() + 90_000 };
      pollDeadline.current = activeDeadline;
    } else if (!activeDeadline.evaluationId && effectiveEvaluationId) {
      activeDeadline.evaluationId = effectiveEvaluationId;
    }
    let active = true; let attempt = 0; const deadline = activeDeadline.deadline; const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { setNotice("Evaluation is still running. Refresh later to continue monitoring."); return;
    }
    const expire = () => { if (!active) return; active = false; if (timer) clearTimeout(timer); setNotice("Evaluation is still running. Refresh later to continue monitoring."); controller.abort(); };
    const deadlineTimer = setTimeout(expire, remaining);
    const settle = () => { active = false; if (timer) clearTimeout(timer); clearTimeout(deadlineTimer); controller.abort(); };
    const schedule = (wait: number) => { const nextRemaining = deadline - Date.now(); if (nextRemaining <= 0) { expire(); return; } timer = setTimeout(poll, Math.min(wait, nextRemaining)); };
    const poll = async () => { try {
      if (Date.now() >= deadline) { expire(); return; }
      if (!effectiveEvaluationId) { const found = (await getEvaluations(controller.signal)).filter((item) => item.candidateId === candidate.id).sort((left, right) => `${right.completedAt ?? right.startedAt ?? ""}:${right.id}`.localeCompare(`${left.completedAt ?? left.startedAt ?? ""}:${left.id}`))[0]; if (!active || controller.signal.aborted) return; if (found) { if (pollDeadline.current === activeDeadline) activeDeadline.evaluationId = found.id; setEvaluationId(found.id); return; } schedule(delays[attempt++] ?? 5_000); return; }
      const result = await getEvaluation(effectiveEvaluationId, controller.signal); if (!active || controller.signal.aborted || Date.now() >= deadline) return; setPolled(result);
      if (terminal.has(result.status)) { setEvaluationRequestBaseline(null); setNotice(`Evaluation ${result.status}${result.providerRequestId ? `; provider request ${result.providerRequestId}` : ""}.`); pollDeadline.current = null; settle(); await invalidate(); return; }
      schedule(delays[attempt++] ?? 5_000);
    } catch (error) { if (active && !controller.signal.aborted) setNotice(errorNotice(error, "Evaluation progress is unavailable. Refresh to retry.")); } };
    schedule(delays[attempt++] ?? 1_000); return settle;
  }, [candidate.id, candidate.state, currentEvidenceStatus, effectiveEvaluationId, evaluate.isSuccess, invalidate]);
  const runAvailable = candidate.state === "evaluating" && !["pending", "running"].includes(currentEvidence?.status ?? "");
  const canReview = candidate.state === "review_required" && Boolean(currentEvidence);
  return <section className="review-actions"><div><strong>{blocked ? "Promotion blocked" : "Evaluation evidence passed"}</strong><small>{blocked ? "Approval requires passed, current, non-quarantined evidence." : "Review is bound to the completed evaluation run."}</small>{notice ? <small role="status">{notice}</small> : null}</div>
    {candidate.state === "proposed" ? <button className="button primary" onClick={() => screen.mutate()} disabled={screen.isPending}>Screen candidate</button> : null}
    {runAvailable ? <button className="button primary" onClick={() => evaluate.mutate()} disabled={evaluate.isPending}><Play size={14} />Run evaluation</button> : null}
    <label>Review reason<input aria-label="Review reason" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <button className="button subtle" disabled={!canReview || !reason || review.isPending} onClick={() => review.mutate("rejected")}><X size={14} />Reject</button><button className="button danger-button" disabled={!canReview || !reason || review.isPending} onClick={() => review.mutate("quarantined")}><ShieldX size={14} />Quarantine</button><button className="button primary" disabled={!canReview || blocked || !reason || review.isPending} onClick={() => review.mutate("approved")}><Check size={14} />Approve</button>
    {candidate.state === "approved" ? <><label>Stable key<input aria-label="Stable key" value={stableKey} onChange={(event) => setStableKey(event.target.value)} /></label><button className="button primary" disabled={!reviewId || !stableKey || !reason || promote.isPending} onClick={() => promote.mutate()}>Promote</button></> : null}
  </section>;
}
