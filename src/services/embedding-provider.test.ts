import { describe, expect, it } from "vitest";

import { createEmbeddingProvider } from "./embedding-provider";

describe("embedding provider selection", () => {
  it("permits the lexical adapter only in explicit E2E/test execution", async () => {
    await expect(createEmbeddingProvider({ STASH_E2E: "1" }).embed("refund review threshold")).resolves.toMatch(/^\[/);
    expect(() => createEmbeddingProvider({ NODE_ENV: "production" })).toThrow(/managed Bedrock embedding model/i);
  });
});
