// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AuditPage from "../audit/page";
import AgentsPage from "../agents/page";
import ChangeDetailPage from "../changes/[candidateId]/page";
import EvaluationsPage from "../evaluations/page";
import MemoryDetailPage from "../memory/[memoryId]/page";
import ChangesPage from "../changes/page";
import MemoryPage from "../memory/page";
import OverviewPage from "../overview/page";
import OnboardingPage from "../onboarding/page";
import SettingsPage from "../settings/page";
import { TerminalError } from "./async-state";
import { StashApiError } from "../lib/api-client";

const routeParams = vi.hoisted(() => ({ candidateId: "33333333-3333-4333-8333-333333333333", memoryId: "44444444-4444-4444-8444-444444444444" }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), useParams: () => routeParams }));
import { WorkspaceProvider } from "../lib/workspace-provider";

const ids = {
  workspace: "11111111-1111-4111-8111-111111111111",
  namespace: "22222222-2222-4222-8222-222222222222",
  candidate: "33333333-3333-4333-8333-333333333333",
  memory: "44444444-4444-4444-8444-444444444444",
  lineage: "55555555-5555-4555-8555-555555555555",
  author: "66666666-6666-4666-8666-666666666666",
};

function LiveProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkspaceProvider>{children}</WorkspaceProvider></QueryClientProvider>;
}

function installResponses(overrides: Record<string, Response> = {}) {
  const responses: Record<string, unknown> = {
    "/api/session": { tenantId: "tenant-live", principalId: "principal-live", roles: ["owner"], workspaceName: "Mosaic Operations" },
    "/api/stash/v1/overview": { workspace: { id: ids.workspace, name: "Mosaic Operations" }, metrics: { agents: 6, activeMemories: 19, candidates: 4, evaluations: 12, auditEvents: 28 } },
    "/api/stash/v1/candidates": [{ id: ids.candidate, namespaceId: ids.namespace, namespaceName: "claims.east", lineageId: ids.lineage, state: "review_required", memoryClass: "policy", trustClass: "authenticated", canonicalText: "Escalate claims above the live threshold.", contentDigest: "candidate-digest", source: { id: ids.author, uri: "https://records.example/live", signatureVerified: true }, author: { id: ids.author, name: "Ravi" }, findingCount: 2, blockingFindingCount: 0, latestEvaluationId: null, latestApprovedReviewId: null, createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:01:00.000Z" }],
    "/api/stash/v1/memory": [{ id: ids.memory, namespaceId: ids.namespace, namespaceName: "claims.east", lineageId: ids.lineage, stableKey: "claim-escalation", candidateId: ids.candidate, memoryClass: "policy", canonicalText: "Escalate claims above the live threshold.", contentDigest: "memory-digest", version: 5, revision: 37, active: true, reads: 912, validFrom: "2026-08-17T10:00:00.000Z", validUntil: null }],
    "/api/stash/v1/evaluations": [],
    "/api/stash/v1/agents": [],
    "/api/stash/v1/audit": [],
    "/api/stash/v1/workspace/status": { workspace: { id: ids.workspace, name: "Mosaic Operations" }, namespaceCount: 1, namespaces: [{ id: ids.namespace, name: "claims.east" }], integrations: { cockroach: { state: "ready", detail: "Connected" }, aws: { state: "pending", detail: "Receipt pending" }, agent: { state: "ready", detail: "Registered" } } },
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input.toString();
    const response = overrides[path] ?? responses[path];
    if (response instanceof Response) return Promise.resolve(response);
    return Promise.resolve(new Response(JSON.stringify(response), { status: path === "/api/session" ? 200 : 200, headers: { "content-type": "application/json", "x-request-id": "request-live-7" } }));
  }));
}

describe("live product pages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the overview identity and counters returned by the HTTP API", async () => {
    installResponses();
    const { container } = render(<LiveProvider><OverviewPage /></LiveProvider>);

    expect(await screen.findByRole("heading", { name: "Mosaic Operations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Ship trusted memory to agents/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Run agent retrieval/i })).toHaveAttribute("href", "/memory");
    expect(screen.getByRole("link", { name: /Inspect production proof/i })).toHaveAttribute("href", "/settings");
    expect(screen.getByText("19")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Sandbox|fixture|cloud proof pending|Amina|r12|chg-threshold-150|chg-gift-card-poison|chg-tone-preference/i);
  });

  it("renders arbitrary server candidate and memory identifiers rather than fixture records", async () => {
    installResponses();
    render(<><LiveProvider><ChangesPage /></LiveProvider><LiveProvider><MemoryPage /></LiveProvider></>);

    expect(await screen.findByText("Escalate claims above the live threshold.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Escalate claims/i })[0]).toHaveAttribute("href", `/changes/${ids.candidate}`);
    expect(screen.getByRole("link", { name: /claim-escalation/i })).toHaveAttribute("href", `/memory/${ids.memory}`);
  });

  it("offers an honest next action for an empty candidate queue", async () => {
    installResponses({ "/api/stash/v1/candidates": new Response("[]", { headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><ChangesPage /></LiveProvider>);

    expect(await screen.findByText(/No memory changes are waiting for review/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Propose memory/i })).toBeEnabled();
  });

  it("shows a safe request identifier when a provider request fails", async () => {
    installResponses({ "/api/stash/v1/audit": new Response(JSON.stringify({ code: "provider_unavailable", message: "Stash is unavailable.", requestId: "request-audit-9" }), { status: 502, headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><AuditPage /></LiveProvider>);

    expect(await screen.findByText(/Audit data is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/request-audit-9/i)).toBeInTheDocument();
  });

  it("does not mark a degraded provider as healthy", async () => {
    installResponses({ "/api/stash/v1/workspace/status": new Response(JSON.stringify({ workspace: { id: ids.workspace, name: "Mosaic Operations" }, namespaceCount: 1, namespaces: [{ id: ids.namespace, name: "claims.east" }], integrations: { cockroach: { state: "unavailable", detail: "Connection unavailable" }, aws: { state: "blocked", detail: "Credentials required" }, agent: { state: "pending", detail: "Waiting" } } }), { headers: { "content-type": "application/json" } }) });
    render(<><LiveProvider><SettingsPage /></LiveProvider><LiveProvider><OnboardingPage /></LiveProvider></>);
    expect(await screen.findByText("Provider attention required")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).not.toHaveClass("low");
    expect(screen.getByText("blocked")).not.toHaveClass("low");
  });

  it("shows judges a downloadable production and vector verification receipt", async () => {
    installResponses();
    render(<LiveProvider><SettingsPage /></LiveProvider>);

    expect(await screen.findByRole("heading", { name: "Production verification receipt" })).toBeInTheDocument();
    expect(screen.getByText("VECTOR(1024)")).toBeInTheDocument();
    expect(screen.getByText(/AWS · us-east-1 · BASIC · CREATED/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Inspect redacted receipt/i })).toHaveAttribute("href", "/evidence/stash-production.json");
  });

  it("renders live agents factually", async () => {
    installResponses({ "/api/stash/v1/agents": new Response(JSON.stringify([{ id: ids.author, name: "Verifier", namespaceIds: [ids.namespace], reads: 8, lastReadAt: "2026-08-17T10:00:00.000Z" }]), { headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><AgentsPage /></LiveProvider>);
    expect(await screen.findByText("Verifier")).toBeInTheDocument();
    expect(screen.queryByText("Reporting")).not.toBeInTheDocument();
  });

  it("loads the requested candidate detail from the HTTP boundary", async () => {
    const candidate = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", namespaceId: ids.namespace, namespaceName: "arbitrary.namespace", lineageId: null, state: "approved", memoryClass: "constraint", trustClass: "authoritative", canonicalText: "Arbitrary live candidate payload", contentDigest: "arbitrary-digest", source: { id: ids.author, uri: "https://records.example/arbitrary", signatureVerified: true }, author: { id: ids.author, name: "Arbitrary reviewer" }, findingCount: 7, blockingFindingCount: 0, latestEvaluationId: null, latestApprovedReviewId: null, createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:01:00.000Z" };
    routeParams.candidateId = candidate.id;
    installResponses({ [`/api/stash/v1/candidates/${candidate.id}`]: new Response(JSON.stringify(candidate), { headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><ChangeDetailPage /></LiveProvider>);
    expect(await screen.findByRole("heading", { name: candidate.canonicalText })).toBeInTheDocument();
    expect(screen.getByText(candidate.id)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/stash/v1/candidates/${candidate.id}`, { cache: "no-store", method: "GET" });
  });

  it("loads the requested memory detail and renders provider lineage", async () => {
    const memory = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", namespaceId: ids.namespace, namespaceName: "arbitrary.namespace", lineageId: ids.lineage, stableKey: "arbitrary-memory", candidateId: ids.candidate, memoryClass: "fact", canonicalText: "Arbitrary memory payload", contentDigest: "memory-digest", version: 9, revision: 44, active: true, reads: 123, validFrom: "2026-08-17T10:00:00.000Z", validUntil: null };
    routeParams.memoryId = memory.id;
    installResponses({ [`/api/stash/v1/memory/${memory.id}`]: new Response(JSON.stringify({ ...memory, lineage: [memory] }), { headers: { "content-type": "application/json" } }) });
    const { unmount } = render(<LiveProvider><MemoryDetailPage /></LiveProvider>);
    expect(await screen.findByRole("heading", { name: memory.stableKey })).toBeInTheDocument();
    const lineage = screen.getByRole("list");
    expect(within(lineage).getByText("Version 9")).toBeInTheDocument();
    expect(within(lineage).getByText("Arbitrary memory payload")).toBeInTheDocument();
    expect(within(lineage).getByText(/revision 44.*2026-08-17T10:00:00.000Z/)).toBeInTheDocument();
    expect(screen.queryByText("No lineage is available")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/stash/v1/memory/${memory.id}`, { cache: "no-store", method: "GET" });
    unmount();
    installResponses({ [`/api/stash/v1/memory/${memory.id}`]: new Response(JSON.stringify({ ...memory, lineage: [] }), { headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><MemoryDetailPage /></LiveProvider>);
    expect(await screen.findByText("No lineage is available")).toBeInTheDocument();
  });

  it("renders live evaluation results and a neutral empty matrix", async () => {
    const evaluationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const evaluation = { id: evaluationId, candidateId: ids.candidate, baselineRevision: 44, policyVersion: "live-policy", status: "passed", modelId: "provider-model", providerRequestId: "run-receipt", startedAt: "2026-08-17T10:00:00.000Z", completedAt: "2026-08-17T10:01:00.000Z", resultCount: 1, results: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", scenarioId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", scenarioName: "Arbitrary provider scenario", status: "passed", artifactUri: null, providerRequestId: "scenario-receipt", createdAt: "2026-08-17T10:01:00.000Z" }] };
    installResponses({ "/api/stash/v1/evaluations": new Response(JSON.stringify([{ ...evaluation, results: undefined }]), { headers: { "content-type": "application/json" } }), [`/api/stash/v1/evaluations/${evaluationId}`]: new Response(JSON.stringify(evaluation), { headers: { "content-type": "application/json" } }) });
    const { unmount } = render(<LiveProvider><EvaluationsPage /></LiveProvider>);
    expect(await screen.findByText("Arbitrary provider scenario")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(`/api/stash/v1/evaluations/${evaluationId}`, { cache: "no-store", method: "GET" });
    unmount();
    installResponses({ "/api/stash/v1/evaluations": new Response("[]", { headers: { "content-type": "application/json" } }) });
    render(<LiveProvider><EvaluationsPage /></LiveProvider>);
    expect(await screen.findByText("No evaluation runs are available")).toBeInTheDocument();
    expect(screen.getByText("0 results")).not.toHaveClass("complete");
  });

  it("renders only the safe API error message and request ID", () => {
    render(<TerminalError title="Request unavailable" error={new StashApiError({ code: "provider_unavailable", message: "Stash is unavailable.", requestId: "safe-request", status: 502 })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Stash is unavailable. Request ID: safe-request");
  });
});
