// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LineageTimeline } from "../components/lineage-timeline";
import { queryKeys } from "../lib/api-client";
import { MemoryExplorer } from "../components/memory-explorer";
const memory = { id: "11111111-1111-4111-8111-111111111111", namespaceId: "22222222-2222-4222-8222-222222222222", namespaceName: "claims", lineageId: "33333333-3333-4333-8333-333333333333", stableKey: "live-memory", candidateId: "44444444-4444-4444-8444-444444444444", memoryClass: "policy" as const, canonicalText: "Live payload", contentDigest: "digest", version: 5, revision: 37, active: true, reads: 9, validFrom: "2026-08-17T10:00:00.000Z", validUntil: null };
describe("memory explorer", () => { it("filters live records", async () => { const user = userEvent.setup(); render(<MemoryExplorer memories={[memory]} />); await user.type(screen.getByLabelText("Search active memory"), "live"); expect(screen.getByText("live-memory")).toBeInTheDocument(); }); it("renders returned lineage", () => { render(<QueryClientProvider client={new QueryClient()}><LineageTimeline lineage={[memory]} /></QueryClientProvider>); expect(screen.getByText("Version 5")).toBeInTheDocument(); }); it("shows the rollback receipt revision and invalidates the displayed memory", async () => { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); const invalidate = vi.spyOn(client, "invalidateQueries"); const target = { ...memory, id: "55555555-5555-4555-8555-555555555555", version: 4, revision: 36, active: false }; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ memoryVersionId: memory.id, lineageId: memory.lineageId, candidateId: memory.candidateId, revision: 38, version: 6, active: true }), { headers: { "content-type": "application/json" } }))); render(<QueryClientProvider client={client}><LineageTimeline workspaceId="workspace-1" memoryId={memory.id} lineage={[target, memory]} /></QueryClientProvider>); fireEvent.click(screen.getByRole("button", { name: "Rollback here" })); fireEvent.change(screen.getByLabelText("Rollback confirmation"), { target: { value: "ROLLBACK" } }); fireEvent.change(screen.getByLabelText("Rollback reason"), { target: { value: "Correct live policy" } }); fireEvent.click(screen.getByRole("button", { name: "Rollback" })); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); expect(screen.getByRole("status")).toHaveTextContent("revision 38"); expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.memory("workspace-1", memory.id) }); });

  it("retains a rollback request key for the same retry and rotates it after request fields change", async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const target = { ...memory, id: "55555555-5555-4555-8555-555555555555", version: 4, revision: 36, active: false };
    const failure = () => new Response(JSON.stringify({ code: "provider_unavailable", message: "Try again.", requestId: "request-rollback" }), { status: 503, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(failure()));
    vi.stubGlobal("fetch", fetchMock);
    render(<QueryClientProvider client={client}><LineageTimeline workspaceId="workspace-1" memoryId={memory.id} lineage={[target, memory]} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Rollback here" }));
    fireEvent.change(screen.getByLabelText("Rollback confirmation"), { target: { value: "ROLLBACK" } });
    fireEvent.change(screen.getByLabelText("Rollback reason"), { target: { value: "Reason:a" } });
    fireEvent.click(screen.getByRole("button", { name: "Rollback" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rollback" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Rollback" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Rollback reason"), { target: { value: "Reason:b" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Rollback" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Rollback" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const keys = fetchMock.mock.calls.map(([, init]) => (init as RequestInit).headers as Record<string, string>);
    expect(keys[1]?.["idempotency-key"]).toBe(keys[0]?.["idempotency-key"]);
    expect(keys[2]?.["idempotency-key"]).not.toBe(keys[1]?.["idempotency-key"]);
  });
});
