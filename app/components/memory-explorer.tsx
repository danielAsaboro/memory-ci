"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import type { MemorySummary } from "../../src/contracts/dashboard";
import { searchMemory } from "../lib/api-client";
import { EmptyState } from "./async-state";

export function MemoryExplorer({ memories, agent }: { workspaceId?: string; memories: MemorySummary[]; agent?: { id: string; name: string } }) {
  const [query, setQuery] = useState("");
  const [semanticQuery, setSemanticQuery] = useState("");
  const [retrieval, setRetrieval] = useState<{ revision: number; readReceiptId: string; ids: Set<string> } | null>(null);
  const [retrievalError, setRetrievalError] = useState<string | null>(null);
  const [retrieving, setRetrieving] = useState(false);
  const namespaceId = memories[0]?.namespaceId;
  const visible = memories.filter((memory) => {
    if (retrieval && !retrieval.ids.has(memory.id)) return false;
    return `${memory.stableKey} ${memory.canonicalText} ${memory.namespaceName}`.toLowerCase().includes(query.toLowerCase());
  });
  async function retrieve() {
    if (!agent || !namespaceId || !semanticQuery.trim()) return;
    setRetrieving(true); setRetrievalError(null);
    try {
      const receipt = await searchMemory({ namespaceId, agentId: agent.id, query: semanticQuery.trim(), purpose: "judge-visible agent retrieval" });
      setRetrieval({ revision: receipt.revision, readReceiptId: receipt.readReceiptId, ids: new Set(receipt.memories.map((memory) => memory.id)) });
    } catch (error) {
      setRetrievalError(error instanceof Error ? error.message : "Semantic retrieval failed.");
    } finally { setRetrieving(false); }
  }
  return <><section className="panel semantic-retrieval"><div className="panel-heading"><div><span className="eyebrow">Agent memory in action</span><h2>Semantic retrieval</h2></div><span className="tag">CockroachDB VECTOR(1024)</span></div>
    <form onSubmit={(event) => { event.preventDefault(); void retrieve(); }}><label><span className="sr-only">Semantic memory query</span><Search size={15} /><input aria-label="Semantic memory query" value={semanticQuery} onChange={(event) => setSemanticQuery(event.target.value)} placeholder="Ask by meaning: When must a person review a refund?" /></label><button className="button primary" disabled={!agent || !namespaceId || !semanticQuery.trim() || retrieving}>{retrieving ? "Retrieving…" : "Retrieve semantically"}</button></form>
    {!agent ? <p className="semantic-note">No registered agent is available for a persisted read.</p> : <p className="semantic-note">Run this query as <strong>{agent.name}</strong>. Stash searches active vectors and persists exactly what the agent read.</p>}
    {retrieval ? <div className="retrieval-receipt" role="status"><strong>{agent?.name} retrieved revision {retrieval.revision}</strong><span>Persisted read receipt</span><code>{retrieval.readReceiptId}</code></div> : null}
    {retrievalError ? <p role="alert">{retrievalError}</p> : null}
  </section><section className="panel"><div className="panel-heading"><div><span className="eyebrow">Committed state</span><h2>{retrieval ? "Retrieved active memory" : "Active memory"}</h2></div><label className="memory-search"><Search size={14} /><span className="sr-only">Search active memory</span><input aria-label="Search active memory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter loaded memory" /></label></div>
    <div className="memory-table"><div className="memory-row memory-header"><span>Memory</span><span>Class</span><span>Value</span><span>Version</span><span>Reads</span></div>{visible.map((memory) => <a className="memory-row" href={`/memory/${memory.id}`} key={memory.id}><span><strong>{memory.stableKey}</strong><small>{memory.namespaceName}</small></span><span className="tag">{memory.memoryClass}</span><span>{memory.canonicalText}</span><span><code>v{memory.version}</code><small>r{memory.revision}</small></span><span>{memory.reads}</span></a>)}{!visible.length ? <EmptyState title={query ? "No matching memory" : "No active memory is available"} detail={query ? "Try a different search term." : "Committed memory will appear after activation."} /> : null}</div>
  </section></>;
}
