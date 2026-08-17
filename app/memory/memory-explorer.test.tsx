// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LineageTimeline } from "../components/lineage-timeline";
import { MemoryExplorer } from "../components/memory-explorer";
const memory = { id: "11111111-1111-4111-8111-111111111111", namespaceId: "22222222-2222-4222-8222-222222222222", namespaceName: "claims", lineageId: "33333333-3333-4333-8333-333333333333", stableKey: "live-memory", candidateId: "44444444-4444-4444-8444-444444444444", memoryClass: "policy" as const, canonicalText: "Live payload", contentDigest: "digest", version: 5, revision: 37, active: true, reads: 9, validFrom: "2026-08-17T10:00:00.000Z", validUntil: null };
describe("memory explorer", () => { it("filters live records", async () => { const user = userEvent.setup(); render(<MemoryExplorer memories={[memory]} />); await user.type(screen.getByLabelText("Search active memory"), "live"); expect(screen.getByText("live-memory")).toBeInTheDocument(); }); it("renders returned lineage", () => { render(<QueryClientProvider client={new QueryClient()}><LineageTimeline lineage={[memory]} /></QueryClientProvider>); expect(screen.getByText("Version 5")).toBeInTheDocument(); }); });
