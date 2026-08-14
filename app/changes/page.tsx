import { ChangeQueue } from "../components/change-queue";

export default function ChangesPage() { return <><div className="page-header"><div><span className="eyebrow">Release queue</span><h1>Memory changes</h1><p>Review provenance, semantic impact, and counterfactual behavior before activation.</p></div><button className="button secondary">Propose memory</button></div><ChangeQueue /></>; }
