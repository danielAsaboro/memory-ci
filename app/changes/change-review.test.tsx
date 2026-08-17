// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangeQueue } from "../components/change-queue";
import { ProvenanceCard } from "../components/provenance-card";
import { ReviewActions } from "../components/review-actions";
const candidate = { id: "11111111-1111-4111-8111-111111111111", namespaceId: "22222222-2222-4222-8222-222222222222", namespaceName: "claims", lineageId: null, state: "quarantined" as const, memoryClass: "policy" as const, trustClass: "untrusted" as const, canonicalText: "Live candidate", contentDigest: "digest", source: { id: "33333333-3333-4333-8333-333333333333", uri: "https://source", signatureVerified: false }, author: { id: "44444444-4444-4444-8444-444444444444", name: "Live author" }, findingCount: 2, blockingFindingCount: 1, latestEvaluationId: null, latestApprovedReviewId: null, createdAt: "2026-08-17T10:00:00.000Z", updatedAt: "2026-08-17T10:00:00.000Z" };
describe("change review experience", () => { it("renders server candidate evidence", () => { render(<ChangeQueue candidates={[candidate]} />); expect(screen.getByText("Live candidate")).toBeInTheDocument(); }); it("shows provenance returned by the service", () => { render(<ProvenanceCard source="https://source" trust="untrusted" signatureVerified={false} digest="digest" />); expect(screen.getByText("not verified")).toBeInTheDocument(); }); it("keeps lifecycle decisions disabled", () => { render(<ReviewActions blocked />); expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled(); }); });
