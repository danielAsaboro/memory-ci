import { describe, expect, it } from "vitest";

import { assertTemplateParameterNames, buildSamDeployArgs, productionParameterNames, validateProductionParameters } from "./production-parameters";

describe("production SAM parameters", () => {
  const valid = {
    DatabaseSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:stash/database-live",
    BedrockModelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    BedrockEmbeddingModelId: "amazon.titan-embed-text-v2:0",
    StashSessionSecret: "a-server-only-secret-with-at-least-32-bytes",
    StashBootstrapKey: "another-server-only-secret-at-least-32-bytes",
    StashTrustedSourceKeys: "[{\"identity\":\"owner\",\"keyId\":\"v1\",\"publicKey\":\"MCowBQYDK2VwAyEAOIRGYgILOl6/p2JN7GM3/xVIFiIOf9xO45Mo8+D5K3s=\"}]",
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

  it("rejects placeholder secrets, wrong AWS provenance, and empty trusted-key registries", () => {
    expect(() => validateProductionParameters({ ...valid, DatabaseSecretArn: "arn:aws:secretsmanager:us-west-2:000000000000:secret:example" })).toThrow(/DatabaseSecretArn/);
    expect(() => validateProductionParameters({ ...valid, StashSessionSecret: "replace-with-a-32-byte-server-only-secret" })).toThrow(/placeholder/i);
    expect(() => validateProductionParameters({ ...valid, StashTrustedSourceKeys: "[]" })).toThrow(/trusted/i);
  });

  it("passes only the parameter file path to SAM, never parameter values", () => {
    const args = buildSamDeployArgs("infra/parameters.production.json");
    expect(args).toContain("file://infra/parameters.production.json");
    expect(args.join(" ")).not.toContain("server-only-secret");
  });
});
