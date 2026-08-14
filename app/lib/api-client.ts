export type IntegrationState = "ready" | "pending" | "blocked" | "unavailable" | "loading";
export type IntegrationStatus = Record<"cockroach" | "aws" | "agent", { state: IntegrationState; detail: string }>;

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function getIntegrationStatus(): Promise<{ demoMode: boolean; status: IntegrationStatus }> {
  if (!apiBase) {
    return {
      demoMode: true,
      status: {
        cockroach: { state: "ready", detail: "Local CockroachDB 26.2 · vector indexes online" },
        aws: { state: "ready", detail: "Sandbox fixture · authenticated cloud proof pending" },
        agent: { state: "ready", detail: "Northstar Refund Agent · revision 12" },
      },
    };
  }
  const response = await fetch(`${apiBase}/v1/integrations/status`, { cache: "no-store" });
  if (!response.ok) throw new Error("Integration status is unavailable.");
  return { demoMode: false, status: await response.json() as IntegrationStatus };
}
