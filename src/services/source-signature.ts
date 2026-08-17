import { createPublicKey, verify } from "node:crypto";

export function verifySourceSignature(input: { content: string; signatureAlgorithm?: string; signature?: string; publicKey?: string }): boolean {
  if (input.signatureAlgorithm !== "ed25519" || !input.signature || !input.publicKey) return false;
  try {
    return verify(null, Buffer.from(input.content), createPublicKey({ key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(input.signature, "base64"));
  } catch { return false; }
}
