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

  it("settles as ready after React replays its effect and invalidates once for a newly created workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tenantId: "tenant-1", principalId: "principal-1", roles: ["admin"], workspaceName: "Northstar",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<StrictMode><QueryClientProvider client={client}><WorkspaceProvider><WorkspaceState /></WorkspaceProvider></QueryClientProvider></StrictMode>);

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("does not invalidate queries when an existing workspace session is reused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tenantId: "tenant-1", principalId: "principal-1", roles: ["admin"], workspaceName: "Northstar",
    }), { status: 200 })));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    render(<QueryClientProvider client={client}><WorkspaceProvider><WorkspaceState /></WorkspaceProvider></QueryClientProvider>);

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("exposes an error state when the session endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 502 })));

    render(<QueryClientProvider client={new QueryClient()}><WorkspaceProvider><WorkspaceState /></WorkspaceProvider></QueryClientProvider>);

    expect(await screen.findByText("error")).toBeInTheDocument();
  });
});
