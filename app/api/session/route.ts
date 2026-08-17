import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  WORKSPACE_SESSION_MAX_AGE_SECONDS,
  signWorkspaceSession,
  verifyWorkspaceSession,
  type WorkspaceSession,
} from "../../../src/auth/workspace-session";
import {
  workspaceBootstrapSchema,
  type WorkspaceMetadata,
} from "../../../src/contracts/workspace";

const COOKIE_NAME = "stash_session";

type SessionConfig = {
  apiBaseUrl: string;
  bootstrapKey: string;
  sessionSecret: string;
};

export async function POST(): Promise<Response> {
  let config: SessionConfig;
  try {
    config = readSessionConfig();
  } catch {
    return unavailable(500, "Workspace sessions are not configured.");
  }

  const cookieStore = await cookies();
  const existingToken = cookieStore.get(COOKIE_NAME)?.value;
  if (existingToken) {
    try {
      const session = await verifyWorkspaceSession(existingToken, config.sessionSecret);
      return NextResponse.json(workspaceMetadata(session));
    } catch {
      // An invalid cookie is replaced with a fresh workspace session.
    }
  }

  let bootstrapResponse: Response;
  try {
    bootstrapResponse = await fetch(`${config.apiBaseUrl}/v1/workspaces`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "X-Stash-Bootstrap-Key": config.bootstrapKey,
      },
    });
  } catch {
    return unavailable(502, "Workspace bootstrap is unavailable.");
  }

  if (!bootstrapResponse.ok) {
    return unavailable(502, "Workspace bootstrap is unavailable.");
  }

  const workspace = await parseWorkspaceBootstrap(bootstrapResponse);
  if (!workspace) {
    return unavailable(502, "Workspace bootstrap returned an invalid response.");
  }

  const token = await signWorkspaceSession(workspace, config.sessionSecret);
  const response = NextResponse.json(workspace, { status: 201 });
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: WORKSPACE_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

function readSessionConfig(): SessionConfig {
  const apiBaseUrl = requiredHttpUrl("STASH_API_BASE_URL");
  const bootstrapKey = requiredEnv("STASH_BOOTSTRAP_KEY");
  const sessionSecret = requiredEnv("STASH_SESSION_SECRET");

  if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new Error("STASH_SESSION_SECRET must be at least 32 bytes.");
  }

  return { apiBaseUrl, bootstrapKey, sessionSecret };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function requiredHttpUrl(name: string): string {
  const value = requiredEnv(name);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.toString().replace(/\/$/, "");
}

async function parseWorkspaceBootstrap(response: Response): Promise<WorkspaceMetadata | null> {
  try {
    return workspaceBootstrapSchema.safeParse(await response.json()).data ?? null;
  } catch {
    return null;
  }
}

function workspaceMetadata(session: WorkspaceSession): WorkspaceMetadata {
  return {
    tenantId: session.tenantId,
    principalId: session.principalId,
    roles: [...session.roles],
    workspaceName: session.workspaceName,
  };
}

function unavailable(status: number, message: string): NextResponse {
  return NextResponse.json({ code: "provider_unavailable", message }, { status });
}
