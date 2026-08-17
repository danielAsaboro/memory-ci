import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { canonicalSourceSignaturePayload, createTrustedSourceKeyRegistry, verifyTrustedSourceSignature } from "./source-signature";

describe("trusted source signatures", () => {
  it("keeps delimiter-containing identity and key-ID pairs distinct", () => {
    const first = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const second = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const registry = createTrustedSourceKeyRegistry({ STASH_TRUSTED_SOURCE_KEYS: JSON.stringify([
      { identity: "owner:west", keyId: "v1", publicKey: first },
      { identity: "owner", keyId: "west:v1", publicKey: second },
    ]) });
    expect(registry.resolve("owner:west", "v1")?.publicKey).toBe(first);
    expect(registry.resolve("owner", "west:v1")?.publicKey).toBe(second);
  });

  it("binds a signature to its identity and key ID", () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const registry = createTrustedSourceKeyRegistry({ STASH_TRUSTED_SOURCE_KEYS: JSON.stringify([{ identity: "owner-a", keyId: "v1", publicKey }, { identity: "owner-b", keyId: "v1", publicKey }]) });
    const content = "Signed evidence";
    const signature = sign(null, Buffer.from(canonicalSourceSignaturePayload({ content, signatureIdentity: "owner-a", signatureKeyId: "v1" })), keys.privateKey).toString("base64");
    expect(verifyTrustedSourceSignature({ content, signatureIdentity: "owner-a", signatureKeyId: "v1", signatureAlgorithm: "ed25519", signature }, registry).verified).toBe(true);
    expect(verifyTrustedSourceSignature({ content, signatureIdentity: "owner-b", signatureKeyId: "v1", signatureAlgorithm: "ed25519", signature }, registry).verified).toBe(false);
  });
});
