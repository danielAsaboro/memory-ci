// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceProvider, useWorkspace } from "./workspace-provider";

function WorkspaceState() {
  const { state } = useWorkspace();
  return <output>{state}</output>;
}

describe("WorkspaceProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("settles as ready after React replays its effect without creating a second workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tenantId: "tenant-1", principalId: "principal-1", roles: ["admin"], workspaceName: "Northstar",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<StrictMode><QueryClientProvider client={new QueryClient()}><WorkspaceProvider><WorkspaceState /></WorkspaceProvider></QueryClientProvider></StrictMode>);

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
