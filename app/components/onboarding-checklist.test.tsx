// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { OnboardingChecklist } from "./onboarding-checklist";

describe("OnboardingChecklist", () => {
  it("shows progressive integration status and never labels blocked setup as complete", () => {
    render(<OnboardingChecklist status={{
      cockroach: { state: "ready", detail: "Cluster connected" },
      aws: { state: "blocked", detail: "AWS credentials are not configured" },
      agent: { state: "pending", detail: "Register after AWS is ready" },
    }} onRetry={() => undefined} />);
    expect(screen.getByText("1 of 3 ready")).toBeInTheDocument();
    expect(screen.getByText("Action required")).toBeInTheDocument();
    expect(screen.queryByText("Setup complete")).not.toBeInTheDocument();
  });

  it("supports retry and copying the read-only agent configuration", async () => {
    const user = userEvent.setup();
    let retries = 0;
    render(<OnboardingChecklist status={{
      cockroach: { state: "unavailable", detail: "Connection timed out" },
      aws: { state: "ready", detail: "Bedrock and S3 verified" },
      agent: { state: "ready", detail: "Auditor MCP registered" },
    }} onRetry={() => { retries += 1; }} />);
    await user.click(screen.getByRole("button", { name: /retry cockroachdb/i }));
    expect(retries).toBe(1);
    await user.click(screen.getByRole("button", { name: /copy agent configuration/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Configuration copied");
  });

  it("reports ready provider evidence", () => {
    render(<OnboardingChecklist status={{
      cockroach: { state: "ready", detail: "Local CockroachDB" },
      aws: { state: "ready", detail: "Recorded adapter fixture" },
      agent: { state: "ready", detail: "Demo agent" },
    }} onRetry={() => undefined} />);
    expect(screen.getByText("Setup complete")).toBeInTheDocument();
  });
});
