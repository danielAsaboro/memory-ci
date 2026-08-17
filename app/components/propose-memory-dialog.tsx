"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { createCandidate, queryKeys, type StashApiError } from "../lib/api-client";

type Form = { namespaceId: string; memoryClass: string; trustClass: string; canonicalText: string; sourceUri: string; sourceContent: string; signatureIdentity: string };
const initial: Form = { namespaceId: "", memoryClass: "policy", trustClass: "authenticated", canonicalText: "", sourceUri: "", sourceContent: "", signatureIdentity: "" };

async function digest(text: string) {
  const bytes = new TextEncoder().encode(text);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function ProposeMemoryDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState(initial);
  const key = useRef<string | null>(null);
  const sourceId = useRef<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      key.current ??= crypto.randomUUID(); sourceId.current ??= crypto.randomUUID();
      const sourceDigest = await digest(form.sourceContent);
      return createCandidate({
        namespaceId: form.namespaceId, memoryClass: form.memoryClass, trustClass: form.trustClass,
        canonicalText: form.canonicalText, payload: { canonicalText: form.canonicalText },
        source: { id: sourceId.current, sourceType: "operator", content: form.sourceContent, contentDigest: sourceDigest,
          sourceUri: form.sourceUri || undefined, signatureIdentity: form.signatureIdentity || undefined, signatureVerified: false },
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
    {error ? <p role="alert">{error.message}</p> : null}{submitted ? <p>Candidate {submitted} submitted.</p> : null}
    <div><button type="button" className="button subtle" onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid || mutation.isPending}>{mutation.isError ? "Retry proposal" : "Submit proposal"}</button></div>
  </form></div>;
}
