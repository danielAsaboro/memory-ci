"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { memories } from "../lib/demo-data";

export function MemoryExplorer() {
  const [query, setQuery] = useState("");
  const visible = memories.filter((memory) => `${memory.title} ${memory.value} ${memory.stableKey}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Committed state</span><h2>Active memory</h2></div><label className="memory-search"><Search size={14} /><span className="sr-only">Search active memory</span><input aria-label="Search active memory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search active memory" /></label></div>
    <div className="memory-table"><div className="memory-row memory-header"><span>Memory</span><span>Class</span><span>Value</span><span>Version</span><span>Reads</span></div>{visible.map((memory) => <a className="memory-row" href={`/memory/${memory.id}`} key={memory.id}><span><strong>{memory.title}</strong><small>{memory.source}</small></span><span className="tag">{memory.memoryClass}</span><span>{memory.value}</span><span><code>v{memory.version}</code><small>r{memory.revision}</small></span><span>{memory.reads}</span></a>)}</div>
  </section>;
}
