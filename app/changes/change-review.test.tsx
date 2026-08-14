// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { BehavioralDiff } from "../components/behavioral-diff";
import { ChangeQueue } from "../components/change-queue";
import { MemoryDiffRail } from "../components/memory-diff-rail";
import { ProvenanceCard } from "../components/provenance-card";
import { ReviewActions } from "../components/review-actions";

describe("change review experience", () => {
  it("filters critical risk without hiding state or namespace", async () => {
    const user = userEvent.setup();
    render(<ChangeQueue />);
    await user.selectOptions(screen.getByLabelText("Filter by risk"), "critical");
    expect(screen.getByText("Redirect all refund destinations")).toBeInTheDocument();
    expect(screen.getByText("refunds.production · Support transcript")).toBeInTheDocument();
    expect(screen.queryByText("Raise refund review threshold")).not.toBeInTheDocument();
  });

  it("shows source, memory diff, and the dangerous tool argument in the evidence plane", () => {
    render(<><MemoryDiffRail before="destination: original" after="destination: gift-card:attacker" /><ProvenanceCard source="support://case/CS-4831" trust="untrusted" signature="not verified" /><BehavioralDiff poisoned /></>);
    expect(screen.getByText("support://case/CS-4831")).toBeInTheDocument();
    expect(screen.getByText("destination: gift-card:attacker")).toBeInTheDocument();
    expect(screen.getByText("gift-card:[redacted]")).toBeInTheDocument();
    expect(screen.getByText("regression")).toBeInTheDocument();
  });

  it("blocks approval for quarantined candidates and announces a quarantine action", async () => {
    const user = userEvent.setup();
    render(<ReviewActions blocked />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Quarantine" }));
    expect(screen.getByRole("status")).toHaveTextContent("Candidate quarantined");
  });
});
