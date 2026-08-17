// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvaluationMatrix } from "../components/evaluation-matrix";
describe("EvaluationMatrix", () => { it("renders provider scenario outcomes", () => { render(<EvaluationMatrix evaluations={[{ id: "11111111-1111-4111-8111-111111111111", candidateId: "22222222-2222-4222-8222-222222222222", baselineRevision: 37, policyVersion: "live", status: "passed", modelId: null, providerRequestId: null, startedAt: null, completedAt: null, resultCount: 1, results: [{ id: "33333333-3333-4333-8333-333333333333", scenarioId: "44444444-4444-4444-8444-444444444444", scenarioName: "Live scenario", status: "passed", artifactUri: null, providerRequestId: "receipt", createdAt: "2026-08-17T10:00:00.000Z" }] }]} />); expect(screen.getByText("Live scenario")).toBeInTheDocument(); }); });
