"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { workspaceBootstrapSchema, type WorkspaceMetadata } from "../../src/contracts/workspace";

type WorkspaceState = "loading" | "ready" | "error";
type WorkspaceContextValue = {
  workspace: WorkspaceMetadata | null;
  state: WorkspaceState;
  error: Error | null;
  retry: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const bootstrap = useRef<Promise<{ workspace: WorkspaceMetadata; created: boolean }> | null>(null);
  const invalidated = useRef(false);
  const [attemptId, setAttemptId] = useState(0);
  const [value, setValue] = useState<Omit<WorkspaceContextValue, "retry">>({ workspace: null, state: "loading", error: null });

  const retry = useCallback(() => {
    bootstrap.current = null;
    setValue({ workspace: null, state: "loading", error: null });
    setAttemptId((current) => current + 1);
  }, []);

  useEffect(() => {
    let current = true;
    const attempt = bootstrap.current ??= bootstrapWorkspace();
    void attempt.then(async ({ workspace, created }) => {
      if (!current) return;
      if (created && !invalidated.current) {
        invalidated.current = true;
        await queryClient.invalidateQueries();
      }
      if (current) setValue({ workspace, state: "ready", error: null });
    }).catch((error: unknown) => {
      if (bootstrap.current === attempt) bootstrap.current = null;
      if (current) setValue({ workspace: null, state: "error", error: toError(error) });
    });
    return () => { current = false; };
  }, [attemptId, queryClient]);

  return <WorkspaceContext.Provider value={{ ...value, retry }}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider.");
  return value;
}

async function bootstrapWorkspace(): Promise<{ workspace: WorkspaceMetadata; created: boolean }> {
  const response = await fetch("/api/session", { method: "POST", cache: "no-store" });
  const workspace = workspaceBootstrapSchema.safeParse(parseJson(await response.text()));
  if (!response.ok || !workspace.success) throw new Error("Workspace session is unavailable.");
  return { workspace: workspace.data, created: response.status === 201 };
}

function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { return null; } }
function toError(error: unknown): Error { return error instanceof Error ? error : new Error("Workspace session is unavailable."); }
