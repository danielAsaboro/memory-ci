import { createHash, createPublicKey, verify } from "node:crypto";

import { canonicalJson } from "./provenance";

export type TrustedSourceKey = Readonly<{ identity: string; keyId: string; publicKey: string }>;
export type TrustedSourceKeyRegistry = Readonly<{ version: string; resolve(identity: string, keyId: string): TrustedSourceKey | null }>;
export const SOURCE_SIGNATURE_VERSION = 1;

export function canonicalSourceSignaturePayload(content: string): string {
  return canonicalJson({ version: SOURCE_SIGNATURE_VERSION, content });
}

export function createTrustedSourceKeyRegistry(environment: Readonly<Record<string, string | undefined>> = process.env): TrustedSourceKeyRegistry {
  const configured = environment.STASH_TRUSTED_SOURCE_KEYS;
  if (!configured) return { version: "unconfigured", resolve: () => null };
  let entries: unknown;
  try { entries = JSON.parse(configured); } catch { throw new Error("STASH_TRUSTED_SOURCE_KEYS must be valid JSON."); }
  if (!Array.isArray(entries)) throw new Error("STASH_TRUSTED_SOURCE_KEYS must be an array.");
  const keys = new Map<string, TrustedSourceKey>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Trusted source key entry is invalid.");
    const { identity, keyId, publicKey } = entry as Record<string, unknown>;
    if (typeof identity !== "string" || !identity || typeof keyId !== "string" || !keyId || typeof publicKey !== "string" || !publicKey) throw new Error("Trusted source key requires identity, keyId, and publicKey.");
    let normalizedPublicKey: string;
    try { normalizedPublicKey = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" }).export({ format: "der", type: "spki" }).toString("base64"); } catch { throw new Error("Trusted source key publicKey is invalid."); }
    const key = `${identity}:${keyId}`;
    if (keys.has(key)) throw new Error("Trusted source key identities must be unique.");
    keys.set(key, { identity, keyId, publicKey: normalizedPublicKey });
  }
  return { version: environment.STASH_TRUSTED_SOURCE_KEYS_VERSION ?? createHash("sha256").update(configured).digest("hex"), resolve: (identity, keyId) => keys.get(`${identity}:${keyId}`) ?? null };
}

export function keyFingerprint(publicKey: string): string {
  return createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");
}

export function verifyTrustedSourceSignature(input: { content: string; signatureIdentity?: string; signatureKeyId?: string; signatureAlgorithm?: string; signature?: string }, registry: TrustedSourceKeyRegistry): { verified: boolean; key: TrustedSourceKey | null; canonicalPayload: string | null } {
  if (input.signatureAlgorithm !== "ed25519" || !input.signature || !input.signatureIdentity || !input.signatureKeyId) return { verified: false, key: null, canonicalPayload: null };
  const key = registry.resolve(input.signatureIdentity, input.signatureKeyId);
  const canonicalPayload = canonicalSourceSignaturePayload(input.content);
  if (!key) return { verified: false, key: null, canonicalPayload };
  try { return { verified: verify(null, Buffer.from(canonicalPayload), createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(input.signature, "base64")), key, canonicalPayload }; }
  catch { return { verified: false, key, canonicalPayload }; }
}

export function verifyPersistedSourceSignature(input: { canonicalPayload: string; signatureAlgorithm: string; signature: string; publicKey: string }): boolean {
  if (input.signatureAlgorithm !== "ed25519") return false;
  try { return verify(null, Buffer.from(input.canonicalPayload), createPublicKey({ key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(input.signature, "base64")); }
  catch { return false; }
}
