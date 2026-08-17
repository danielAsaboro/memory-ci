import { describe, expect, it } from "vitest";

import { assertTemplateParameterNames, productionParameterNames, validateProductionParameters } from "./production-parameters";

describe("production SAM parameters", () => {
  const valid = {
    DatabaseSecretArn: "arn:aws:secretsmanager:us-east-1:000000000000:secret:stash/database-placeholder",
    BedrockModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    BedrockEmbeddingModelId: "amazon.titan-embed-text-v2:0",
    StashSessionSecret: "a-server-only-secret-with-at-least-32-bytes",
    StashBootstrapKey: "another-server-only-secret-at-least-32-bytes",
    StashTrustedSourceKeys: "[]",
    AllowedOrigin: "https://trystash.xyz",
  };

  it("accepts precisely the production template parameter contract", () => {
    expect(validateProductionParameters(valid)).toEqual(valid);
    expect(productionParameterNames).toEqual(Object.keys(valid));
    expect(() => assertTemplateParameterNames(productionParameterNames)).not.toThrow();
  });

  it("fails before deployment when a required parameter is missing or unknown", () => {
    const missing = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== "StashBootstrapKey"));
    expect(() => validateProductionParameters(missing)).toThrow(/StashBootstrapKey/);
    expect(() => validateProductionParameters({ ...valid, Unexpected: "nope" })).toThrow(/Unexpected/);
  });

  it("rejects a parameter contract that diverges from the SAM template", () => {
    expect(() => assertTemplateParameterNames([...productionParameterNames, "Unexpected"])).toThrow(/Unexpected/);
  });
});
