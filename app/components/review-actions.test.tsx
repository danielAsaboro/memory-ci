// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CandidateSummary, EvaluationSummary } from "../../src/contracts/dashboard";
import { ReviewActions } from "./review-actions";

const candidate: CandidateSummary = {
  id: "33333333-3333-4333-8333-333333333333", namespaceId: "22222222-2222-4222-8222-222222222222", namespaceName: "refunds",
  lineageId: "44444444-4444-4444-8444-444444444444", state: "review_required", memoryClass: "policy", trustClass: "authoritative",
  canonicalText: "Refunds above $150 require review.", contentDigest: "candidate-digest",
  source: { id: "55555555-5555-4555-8555-555555555555", uri: "https://records.example/refunds", signatureVerified: true },
  author: { id: "66666666-6666-4666-8666-666666666666", name: "Reviewer" }, findingCount: 0, blockingFindingCount: 0, latestEvaluationId: "77777777-7777-4777-8777-777777777777", latestApprovedReviewId: null,
  createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:01:00.000Z",
};
const evaluation: EvaluationSummary = { id: "77777777-7777-4777-8777-777777777777", candidateId: candidate.id, baselineRevision: 4, policyVersion: "policy-v1", status: "passed", modelId: "model", providerRequestId: "provider-run-1", startedAt: "2026-08-17T10:00:00.000Z", completedAt: "2026-08-17T10:01:00.000Z", resultCount: 1 };

function renderActions(overrides: Partial<React.ComponentProps<typeof ReviewActions>> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let props = { workspaceId: "workspace-1", candidate, evaluation, ...overrides };
  const node = () => <QueryClientProvider client={client}><ReviewActions {...props} /></QueryClientProvider>;
  const view = render(node());
  return Object.assign(view, {
    rerenderActions(next: Partial<React.ComponentProps<typeof ReviewActions>>) {
      props = { ...props, ...next };
      view.rerender(node());
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ReviewActions", () => {
  it("does not offer approval for quarantined, inconclusive, or stale evidence", () => {
    renderActions({ candidate: { ...candidate, state: "quarantined", blockingFindingCount: 1 }, evaluation: { ...evaluation, status: "inconclusive" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/Promotion blocked/i)).toBeInTheDocument();
  });

  it("replaces the queued notice when refreshed evidence is already terminal", async () => {
    const eventId = "88888888-8888-4888-8888-888888888888";
    const terminalEvaluation = {
      ...evaluation,
      id: "99999999-9999-4999-8999-999999999999",
      status: "inconclusive" as const,
      providerRequestId: "provider-timeout",
      triggerEventId: eventId,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidateId: candidate.id,
      status: "queued",
      eventId,
    }), { status: 202, headers: { "content-type": "application/json" } })));
    const view = renderActions({ candidate: { ...candidate, state: "evaluating" } });

    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent("Evaluation queued");

    view.rerenderActions({
      candidate: { ...candidate, state: "quarantined", latestEvaluationId: terminalEvaluation.id },
      evaluation: terminalEvaluation,
    });

    expect(screen.getByRole("status")).toHaveTextContent("Evaluation Inconclusive; provider request provider-timeout.");
  });

  it("does not enqueue another evaluation when refreshed evidence is already running", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidateId: candidate.id, status: "queued", eventId: "88888888-8888-4888-8888-888888888888" }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...evaluation, status: "running", completedAt: null, results: [] }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...evaluation, results: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: { ...evaluation, status: "running", completedAt: null } });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(`/api/stash/v1/candidates/${candidate.id}/evaluate`, expect.anything());
    vi.useRealTimers();
  });

  it("polls an advanced authoritative evaluation before its matching evaluation prop arrives", async () => {
    vi.useFakeTimers();
    const nextEvaluation = {
      ...evaluation,
      id: "88888888-8888-4888-8888-888888888888",
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
    };
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderActions();

    view.rerenderActions({
      candidate: { ...candidate, state: "evaluating", latestEvaluationId: nextEvaluation.id },
    });

    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    view.rerenderActions({ evaluation: null });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${nextEvaluation.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    view.rerenderActions({ evaluation: nextEvaluation });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
  });

  it("keeps enqueue hidden when the evaluation prop arrives before the candidate identity", async () => {
    vi.useFakeTimers();
    const nextEvaluation = {
      ...evaluation,
      id: "88888888-8888-4888-8888-888888888888",
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
    };
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderActions();

    view.rerenderActions({
      candidate: { ...candidate, state: "evaluating" },
      evaluation: nextEvaluation,
    });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();

    view.rerenderActions({
      candidate: { ...candidate, state: "evaluating", latestEvaluationId: nextEvaluation.id },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${nextEvaluation.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/stash/v1/candidates/${candidate.id}/evaluate`,
      expect.anything(),
    );
  });

  it("excludes the terminal request baseline when discovering its new pending evaluation", async () => {
    vi.useFakeTimers();
    const nextEvaluation = {
      ...evaluation,
      id: "88888888-8888-4888-8888-888888888888",
      status: "pending" as const,
      startedAt: "2026-08-17T10:02:00.000Z",
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
      triggerEventId: "99999999-9999-4999-8999-999999999999",
    };
    let evaluationListRequests = 0;
    const fetchMock = vi.fn((path: string) => {
      if (path.endsWith(`/candidates/${candidate.id}/evaluate`)) {
        return Promise.resolve(new Response(JSON.stringify({ candidateId: candidate.id, status: "queued", eventId: "99999999-9999-4999-8999-999999999999" }), { headers: { "content-type": "application/json" } }));
      }
      if (path.endsWith("/evaluations")) {
        evaluationListRequests += 1;
        return Promise.resolve(new Response(JSON.stringify([
          { ...evaluation, completedAt: "2026-08-17T10:03:00.000Z" },
          ...(evaluationListRequests === 1 ? [] : [nextEvaluation]),
        ]), { headers: { "content-type": "application/json" } }));
      }
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" } });

    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${nextEvaluation.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${evaluation.id}`,
      expect.anything(),
    );
  });

  it("does not bind any historical evaluation while a newly requested evaluation is absent", async () => {
    vi.useFakeTimers();
    const historicalEvaluation = {
      ...evaluation,
      id: "88888888-8888-4888-8888-888888888888",
      status: "passed" as const,
      startedAt: "2026-08-17T10:01:30.000Z",
      completedAt: "2026-08-17T10:02:30.000Z",
      providerRequestId: "provider-run-older",
    };
    const fetchMock = vi.fn((path: string) => {
      if (path.endsWith(`/candidates/${candidate.id}/evaluate`)) {
        return Promise.resolve(new Response(JSON.stringify({ candidateId: candidate.id, status: "queued", eventId: "99999999-9999-4999-8999-999999999999" }), { headers: { "content-type": "application/json" } }));
      }
      if (path.endsWith("/evaluations")) {
        return Promise.resolve(new Response(JSON.stringify([evaluation, historicalEvaluation]), { headers: { "content-type": "application/json" } }));
      }
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" } });

    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${historicalEvaluation.id}`,
      expect.anything(),
    );
  });

  it("polls only the evaluation bound to the queued outbox event", async () => {
    vi.useFakeTimers();
    const requestedEventId = "99999999-9999-4999-8999-999999999999";
    const requestedEvaluation = {
      ...evaluation,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "pending",
      startedAt: "2026-08-17T10:03:00.000Z",
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
      triggerEventId: requestedEventId,
    };
    const concurrentEvaluation = {
      ...evaluation,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "pending",
      startedAt: "2026-08-17T10:04:00.000Z",
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
      triggerEventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    };
    let listRequests = 0;
    const fetchMock = vi.fn((path: string) => {
      if (path.endsWith(`/candidates/${candidate.id}/evaluate`)) {
        return Promise.resolve(new Response(JSON.stringify({ candidateId: candidate.id, status: "queued", eventId: requestedEventId }), { headers: { "content-type": "application/json" } }));
      }
      if (path.endsWith("/evaluations")) {
        listRequests += 1;
        return Promise.resolve(new Response(JSON.stringify(listRequests === 1 ? [evaluation] : [evaluation, concurrentEvaluation, requestedEvaluation]), { headers: { "content-type": "application/json" } }));
      }
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" } });

    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${requestedEvaluation.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/stash/v1/evaluations/${concurrentEvaluation.id}`,
      expect.anything(),
    );
  });

  it("cancels a candidate-bound poll when the detail view unmounts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...evaluation, status: "running", completedAt: null, results: [] }), { headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    const view = renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: { ...evaluation, status: "running", completedAt: null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("uses 1, 2, 4, then 5 second polling and stops at the 90 second ceiling", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ ...evaluation, status: "running", completedAt: null, results: [] }), { headers: { "content-type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: { ...evaluation, status: "running", completedAt: null } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); }); expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await Promise.resolve(); }); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); await Promise.resolve(); }); expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await Promise.resolve(); }); expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { await vi.advanceTimersByTimeAsync(78_000); });
    expect(screen.getByText(/still running/i)).toBeInTheDocument();
  });

  it("rebinds terminal evidence to an authoritative pending, running, then completed evaluation", async () => {
    vi.useFakeTimers();
    const nextEvaluation = {
      ...evaluation,
      id: "88888888-8888-4888-8888-888888888888",
      status: "pending" as const,
      startedAt: null,
      completedAt: null,
      providerRequestId: null,
      resultCount: 0,
    };
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderActions();

    view.rerenderActions({
      candidate: { ...candidate, state: "evaluating", latestEvaluationId: nextEvaluation.id },
      evaluation: nextEvaluation,
    });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/stash/v1/evaluations/${nextEvaluation.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));

    view.rerenderActions({ evaluation: { ...nextEvaluation, status: "running", startedAt: "2026-08-17T10:02:00.000Z" } });
    expect(signals[0]?.aborted).toBe(true);
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

    view.rerenderActions({
      candidate: { ...candidate, state: "review_required", latestEvaluationId: nextEvaluation.id },
      evaluation: { ...nextEvaluation, status: "passed", startedAt: "2026-08-17T10:02:00.000Z", completedAt: "2026-08-17T10:03:00.000Z", resultCount: 1 },
    });
    expect(signals[1]?.aborted).toBe(true);
    expect(screen.getByText("Evaluation evidence passed")).toBeInTheDocument();
  });

  it.each([
    ["evaluation discovery", null],
    ["evaluation detail", { ...evaluation, status: "running" as const, completedAt: null }],
  ])("aborts a never-resolving %s request at the shared 90 second ceiling", async (_label, currentEvaluation) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));
    renderActions({
      candidate: { ...candidate, state: "evaluating", latestEvaluationId: currentEvaluation?.id ?? null },
      evaluation: currentEvaluation,
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(signals).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(88_999); });
    expect(signals[0]?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(signals[0]?.aborted).toBe(true);
    expect(screen.getByText(/still running/i)).toBeInTheDocument();
  });

  it.each([
    ["evaluation discovery", null],
    ["evaluation detail", { ...evaluation, status: "running" as const, completedAt: null }],
  ])("settles a rejecting %s request without later replacing its safe error", async (_label, currentEvaluation) => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return Promise.reject(new Error("unsafe provider detail"));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderActions({
      candidate: { ...candidate, state: "evaluating", latestEvaluationId: currentEvaluation?.id ?? null },
      evaluation: currentEvaluation,
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByRole("status")).toHaveTextContent("The Stash request could not be completed. Request ID: unknown.");
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => { await vi.advanceTimersByTimeAsync(100_000); });
    expect(screen.getByRole("status")).toHaveTextContent("The Stash request could not be completed. Request ID: unknown.");
    expect(screen.queryByText(/still running/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the original deadline when authoritative status changes restart polling for the same evaluation", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));
    const running = { ...evaluation, status: "running" as const, completedAt: null };
    const view = renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: running });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });

    view.rerenderActions({ evaluation: { ...running, status: "pending" } });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(signals).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(58_999); });
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(signals[1]?.aborted).toBe(true);
  });

  it("starts a new deadline only when the authoritative evaluation identity genuinely changes", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_path: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Promise<Response>(() => undefined);
    }));
    const running = { ...evaluation, status: "running" as const, completedAt: null };
    const view = renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: running });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(29_000); });

    const nextEvaluation = { ...running, id: "88888888-8888-4888-8888-888888888888", status: "pending" as const };
    view.rerenderActions({ candidate: { ...candidate, state: "evaluating", latestEvaluationId: nextEvaluation.id }, evaluation: nextEvaluation });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(signals).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(88_999); });
    expect(signals[1]?.aborted).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(signals[1]?.aborted).toBe(true);
  });

  it("clears a stale approved review and shows the safe request identifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "stale_review", message: "Review evidence has changed.", requestId: "request-stale-1" }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "approved", latestApprovedReviewId: "99999999-9999-4999-8999-999999999999" } });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Approved after evidence review" } });
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "refund.review" } });
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole("status")).toHaveTextContent(/stale/i);
    expect(screen.getByRole("button", { name: "Promote" })).toBeDisabled();
  });

  it("rebinds to newly authoritative pending evidence after stale-review recovery", async () => {
    vi.useFakeTimers();
    const nextEvaluation = { ...evaluation, id: "88888888-8888-4888-8888-888888888888", status: "pending" as const, startedAt: null, completedAt: null, providerRequestId: null, resultCount: 0 };
    const fetchMock = vi.fn((path: string) => {
      if (path.endsWith("/promote")) return Promise.resolve(new Response(JSON.stringify({ code: "stale_review", message: "Review evidence has changed.", requestId: "request-stale-2" }), { status: 409, headers: { "content-type": "application/json" } }));
      return new Promise<Response>(() => undefined);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderActions({ candidate: { ...candidate, state: "approved", latestApprovedReviewId: "99999999-9999-4999-8999-999999999999" } });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "Approved after evidence review" } });
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "refund.review" } });
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    view.rerenderActions({ candidate: { ...candidate, state: "evaluating", latestEvaluationId: nextEvaluation.id, latestApprovedReviewId: null }, evaluation: nextEvaluation });
    expect(screen.queryByRole("button", { name: "Run evaluation" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(fetchMock).toHaveBeenCalledWith(`/api/stash/v1/evaluations/${nextEvaluation.id}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("rotates review keys for structurally distinct requests that collide with delimiter joining", async () => {
    const failure = new Response(JSON.stringify({ code: "provider_unavailable", message: "Try again.", requestId: "request-review" }), { status: 503, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(failure.clone()));
    vi.stubGlobal("fetch", fetchMock);
    const firstEvaluation = { ...evaluation, id: "evaluation-base" };
    const view = renderActions({ candidate: { ...candidate, latestEvaluationId: firstEvaluation.id }, evaluation: firstEvaluation });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "approved:reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const secondEvaluation = { ...evaluation, id: "evaluation-base:approved" };
    view.rerenderActions({ candidate: { ...candidate, latestEvaluationId: secondEvaluation.id }, evaluation: secondEvaluation });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "reason" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    const secondHeaders = (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>;
    expect(secondHeaders["idempotency-key"]).not.toBe(firstHeaders["idempotency-key"]);
  });

  it("retains a promotion key for the same retry but rotates it across delimiter-colliding fields", async () => {
    const failure = new Response(JSON.stringify({ code: "provider_unavailable", message: "Try again.", requestId: "request-promote" }), { status: 503, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(failure.clone()));
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "approved", latestApprovedReviewId: "review-1" } });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "c" } });
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "a:b" } });
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Promote" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText("Review reason"), { target: { value: "b:c" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Promote" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const keys = fetchMock.mock.calls.map(([, init]) => ((init as RequestInit).headers as Record<string, string>)["idempotency-key"]);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
