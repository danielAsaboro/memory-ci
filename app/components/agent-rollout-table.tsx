import { CheckCircle2, Clock3 } from "lucide-react";

const agents = [
  { name: "Refund Agent · us-east-1", revision: 12, reads: "8,284", age: "4s", current: true },
  { name: "Refund Agent · eu-west-1", revision: 12, reads: "6,930", age: "7s", current: true },
  { name: "Refund Agent · ap-southeast-1", revision: 12, reads: "3,202", age: "11s", current: true },
  { name: "Incident replay worker", revision: 9, reads: "84", age: "2m", current: false },
];

export function AgentRolloutTable() { return <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Consumer convergence</span><h2>Registered agents</h2></div><span className="readiness complete">3 live · 1 pinned</span></div><div className="agent-table">{agents.map((agent) => <div className="agent-row" key={agent.name}><span className="agent-icon">{agent.current ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}</span><span><strong>{agent.name}</strong><small>last read {agent.age} ago</small></span><span><small>Revision</small><strong>r{agent.revision}</strong></span><span><small>24h reads</small><strong>{agent.reads}</strong></span><span className={agent.current ? "good-text" : "expected-delta"}>{agent.current ? "Current" : "Pinned"}</span></div>)}</div></section>; }
