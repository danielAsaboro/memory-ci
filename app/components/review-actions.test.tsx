// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <ReviewActions workspaceId="workspace-1" candidate={candidate} evaluation={evaluation} {...overrides} />
  </QueryClientProvider>);
}

describe("ReviewActions", () => {
  it("does not offer approval for quarantined, inconclusive, or stale evidence", () => {
    renderActions({ candidate: { ...candidate, state: "quarantined", blockingFindingCount: 1 }, evaluation: { ...evaluation, status: "inconclusive" } });
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByText(/Promotion blocked/i)).toBeInTheDocument();
  });

  it("starts evaluation and polls the returned run through a terminal state", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidateId: candidate.id, status: "queued", eventId: "88888888-8888-4888-8888-888888888888" }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...evaluation, status: "running", completedAt: null, results: [] }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...evaluation, results: [] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderActions({ candidate: { ...candidate, state: "evaluating" }, evaluation: { ...evaluation, status: "running", completedAt: null } });
    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByText(/Evaluation passed/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      `/api/stash/v1/candidates/${candidate.id}/evaluate`,
      `/api/stash/v1/evaluations/${evaluation.id}`,
      `/api/stash/v1/evaluations/${evaluation.id}`,
    ]);
    vi.useRealTimers();
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
    vi.useRealTimers();
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
    vi.useRealTimers();
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
});
