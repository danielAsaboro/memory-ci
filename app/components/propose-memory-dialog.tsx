"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { createCandidate, queryKeys, type StashApiError } from "../lib/api-client";
import { retryFingerprint } from "../lib/retry-fingerprint";

type Form = { namespaceId: string; memoryClass: string; trustClass: string; canonicalText: string; sourceUri: string; sourceContent: string; signatureIdentity: string; signature: string; publicKey: string };
const initial: Form = { namespaceId: "", memoryClass: "policy", trustClass: "authenticated", canonicalText: "", sourceUri: "", sourceContent: "", signatureIdentity: "", signature: "", publicKey: "" };

async function digest(text: string) {
  const bytes = new TextEncoder().encode(text);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
const base64 = (value: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(value)));

export function ProposeMemoryDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const key = useRef<string | null>(null);
  const fingerprint = useRef<string | null>(null);
  const sourceId = useRef<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const nextFingerprint = retryFingerprint(form); if (fingerprint.current !== nextFingerprint) { fingerprint.current = nextFingerprint; key.current = null; sourceId.current = null; }
      key.current ??= crypto.randomUUID(); sourceId.current ??= crypto.randomUUID();
      const sourceDigest = await digest(form.sourceContent);
      return createCandidate({
        namespaceId: form.namespaceId, memoryClass: form.memoryClass, trustClass: form.trustClass,
        canonicalText: form.canonicalText, payload: { canonicalText: form.canonicalText },
        source: { id: sourceId.current, sourceType: "operator", content: form.sourceContent, contentDigest: sourceDigest,
          sourceUri: form.sourceUri || undefined, signatureIdentity: form.signatureIdentity || undefined, signatureVerified: false,
          ...(form.signature && form.publicKey ? { signatureAlgorithm: "ed25519" as const, signature: form.signature, publicKey: form.publicKey } : {}) },
      }, key.current);
    },
    onSuccess: async (receipt) => {
      setSubmitted(receipt.id);
      await client.invalidateQueries({ queryKey: queryKeys.candidates(workspaceId) });
      await client.invalidateQueries({ queryKey: queryKeys.overview(workspaceId) });
      await client.invalidateQueries({ queryKey: queryKeys.audit(workspaceId) });
    },
  });
  const change = (name: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((value) => ({ ...value, [name]: event.target.type === "checkbox" ? (event.target as HTMLInputElement).checked : event.target.value }));
  const signSource = async () => {
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const signature = await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(form.sourceContent));
    const publicKey = await crypto.subtle.exportKey("spki", keys.publicKey);
    setForm((value) => ({ ...value, signature: base64(signature), publicKey: base64(publicKey) }));
  };
  const valid = Boolean(form.namespaceId && form.canonicalText && form.sourceContent && form.sourceUri);
  const error = mutation.error as StashApiError | null;
  return <div className="modal-scrim" role="dialog" aria-modal="true" aria-labelledby="propose-memory-title"><form className="confirm-dialog" onSubmit={(event) => { event.preventDefault(); if (valid) mutation.mutate(); }}>
    <button type="button" className="dialog-close" onClick={onClose} aria-label="Close proposal">×</button><h3 id="propose-memory-title">Propose memory</h3>
    <label>Namespace ID<input aria-label="Namespace ID" value={form.namespaceId} onChange={change("namespaceId")} required /></label>
    <label>Memory class<select aria-label="Memory class" value={form.memoryClass} onChange={change("memoryClass")}>{["policy", "fact", "preference", "episode", "skill", "constraint"].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Trust class<select aria-label="Trust class" value={form.trustClass} onChange={change("trustClass")}>{["untrusted", "observed", "authenticated", "authoritative"].map((value) => <option key={value}>{value}</option>)}</select></label>
    <label>Canonical text<textarea aria-label="Canonical text" value={form.canonicalText} onChange={change("canonicalText")} required /></label>
    <label>Source URI<input aria-label="Source URI" type="url" value={form.sourceUri} onChange={change("sourceUri")} required /></label>
    <label>Source content<textarea aria-label="Source content" value={form.sourceContent} onChange={change("sourceContent")} required /></label>
    <label>Signature identity<input aria-label="Signature identity" value={form.signatureIdentity} onChange={change("signatureIdentity")} /></label>
    <button type="button" className="button subtle" onClick={() => { void signSource(); }} disabled={!form.sourceContent}>Generate and sign source evidence</button>
    {form.signature ? <p role="status">Source signature generated.</p> : null}
    {error ? <p role="alert">{error.message}</p> : null}{submitted ? <p>Candidate {submitted} submitted.</p> : null}
    <div><button type="button" className="button subtle" onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid || mutation.isPending}>{mutation.isError ? "Retry proposal" : "Submit proposal"}</button></div>
  </form></div>;
}
