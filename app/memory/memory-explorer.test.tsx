// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LineageTimeline } from "../components/lineage-timeline";
import { MemoryExplorer } from "../components/memory-explorer";

describe("memory explorer", () => {
  it("filters by semantic label while preserving revision and provenance", async () => {
    const user = userEvent.setup();
    render(<MemoryExplorer />);
    await user.type(screen.getByLabelText("Search active memory"), "destination");
    expect(screen.getByText("Refund destination")).toBeInTheDocument();
    expect(screen.getByText("Payments control · signed")).toBeInTheDocument();
    expect(screen.getByText("r9")).toBeInTheDocument();
    expect(screen.queryByText("High-value escalation")).not.toBeInTheDocument();
  });

  it("requires confirmation before rollback and announces the selected target", async () => {
    const user = userEvent.setup();
    render(<LineageTimeline />);
    await user.click(screen.getByRole("button", { name: "Roll back to version 2" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Create revision 13 from version 2?");
    await user.click(screen.getByRole("button", { name: "Confirm rollback" }));
    expect(screen.getByRole("status")).toHaveTextContent("Rollback requested for version 2");
  });
});
