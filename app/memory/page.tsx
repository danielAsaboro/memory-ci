import { MemoryExplorer } from "../components/memory-explorer";

export default function MemoryPage() { return <><div className="page-header"><div><span className="eyebrow">System of record</span><h1>Memory explorer</h1><p>Search only committed versions. Every result is revision-bound and attributable.</p></div><span className="status-chip good"><span />Vector index online</span></div><MemoryExplorer /></>; }
