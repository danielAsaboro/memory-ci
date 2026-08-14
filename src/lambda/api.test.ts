import { describe, expect, it } from "vitest";

import { handler } from "./api";

describe("API Gateway Lambda adapter", () => {
  it("serves a dependency-free health check", async () => {
    const response = await handler({ path: "/health", requestContext: { requestId: "req-health" } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok", requestId: "req-health" });
  });

  it("fails closed before opening a database connection when Cognito claims are absent", async () => {
    const response = await handler({ path: "/v1/candidates", httpMethod: "GET", requestContext: { requestId: "req-auth" } });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body).code).toBe("unauthorized");
  });
});
