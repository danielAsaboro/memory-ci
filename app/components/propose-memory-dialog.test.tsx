// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProposeMemoryDialog } from "./propose-memory-dialog";

function renderDialog() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <ProposeMemoryDialog workspaceId="workspace-1" onClose={vi.fn()} />
  </QueryClientProvider>);
}

describe("ProposeMemoryDialog", () => {
  it("submits canonical content and provenance, retaining its idempotency key for retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "provider_unavailable", message: "Try again.", requestId: "request-1" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "33333333-3333-4333-8333-333333333333", state: "proposed", contentDigest: "candidate-digest", provenanceVerified: true, redactions: [] }), { headers: { "content-type": "application/json", "x-request-id": "request-2" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog();
    expect(screen.queryByLabelText("Signature verified")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Namespace ID"), { target: { value: "22222222-2222-4222-8222-222222222222" } });
    fireEvent.change(screen.getByLabelText("Canonical text"), { target: { value: "Refunds above $150 require review." } });
    fireEvent.change(screen.getByLabelText("Source URI"), { target: { value: "https://records.example/refunds" } });
    fireEvent.change(screen.getByLabelText("Source content"), { target: { value: "Signed refund policy update." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));

    expect(await screen.findByText("Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry proposal" }));
    await waitFor(() => expect(screen.getByText(/Candidate .*submitted/i)).toBeInTheDocument());

    const first = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const second = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(first.headers).toMatchObject({ "idempotency-key": expect.any(String) });
    expect(second.headers).toMatchObject({ "idempotency-key": (first.headers as Record<string, string>)["idempotency-key"] });
    expect(JSON.parse(first.body as string)).toMatchObject({
      namespaceId: "22222222-2222-4222-8222-222222222222",
      canonicalText: "Refunds above $150 require review.",
      source: { sourceUri: "https://records.example/refunds", content: "Signed refund policy update." },
    });
  });
});
