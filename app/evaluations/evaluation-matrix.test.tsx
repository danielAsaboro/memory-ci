// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EvaluationMatrix } from "../components/evaluation-matrix";

describe("EvaluationMatrix", () => {
  it("distinguishes unchanged passes from intentional behavior changes", () => {
    render(<EvaluationMatrix />);
    expect(screen.getByText("Refund between $100–$150")).toBeInTheDocument();
    expect(screen.getByText("Expected delta")).toBeInTheDocument();
    expect(screen.getAllByText("Passed").length).toBeGreaterThan(1);
    expect(screen.getByText("5 / 5 conclusive")).toBeInTheDocument();
  });
});
