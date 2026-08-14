export async function handler(event: { requestContext?: { requestId?: string }; rawPath?: string; path?: string }) {
  const requestId = event.requestContext?.requestId ?? crypto.randomUUID();
  return {
    statusCode: 503,
    headers: { "content-type": "application/json", "x-request-id": requestId },
    body: JSON.stringify({
      code: "deployment_not_configured",
      message: "Memory CI requires CockroachDB Cloud and Cognito deployment configuration.",
      requestId,
      path: event.rawPath ?? event.path ?? "/",
    }),
  };
}
