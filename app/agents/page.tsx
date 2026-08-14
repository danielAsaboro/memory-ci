import { AgentRolloutTable } from "../components/agent-rollout-table";

export default function AgentsPage() { return <><div className="page-header"><div><span className="eyebrow">Revision consumers</span><h1>Agents</h1><p>See which committed revision every agent actually read—across regions and replay jobs.</p></div><button className="button secondary">Register agent</button></div><AgentRolloutTable /></>; }
