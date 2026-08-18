import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { ReleaseShowcase } from "./components/release-showcase";

export default function Home() {
  return <main className="vibe-page">
    <section className="vibe-hero">
      <nav className="vibe-nav" aria-label="Main navigation">
        <Link href="/" className="vibe-brand"><ShieldCheck size={16} /> Stash</Link>
        <div><a href="#how-it-works">How it works</a><a href="#why-stash">Why Stash</a><Link href="/overview" className="vibe-login">Open control plane <ArrowRight size={13} /></Link></div>
      </nav>
      <div className="vibe-hero-grid">
        <div className="vibe-copy"><p>RELEASE CONTROL FOR AI MEMORY</p><h1>All your agent memory <em>in one place.</em></h1><span>Propose, screen, evaluate, and promote every change with the proof your team needs to trust it.</span><Link href="/overview" className="vibe-cta">Open the control plane <ArrowRight size={15} /></Link></div>
        <div className="vibe-hero-note"><span>Not a database write.</span><strong>A governed release.</strong><p>Stash binds evidence, approval, and lineage before memory becomes active.</p></div>
      </div>
    </section>

    <ReleaseShowcase />

    <section id="why-stash" className="vibe-benefits">
      <div><p>Why teams choose</p><h2>Stash <em>for memory.</em></h2><span>Built for the moment a memory change becomes production truth.</span></div>
      <div className="vibe-stats"><article><strong>100%</strong><span>traceable releases</span><small>Every promotion binds approval, evidence, and revision.</small></article><article><strong>0</strong><span>silent writes</span><small>Unsafe candidates never reach agent retrieval.</small></article><article><strong>1</strong><span>source of truth</span><small>Transaction and vector memory stay consistent.</small></article></div>
    </section>

    <section id="how-it-works" className="vibe-work">
      <div className="work-heading"><h2>How Stash works</h2><p>Memory gets the same rigor as code.</p><span>A deliberately simple release path, with all the evidence when you need it.</span></div>
      <div className="work-rows"><article><b>1</b><div><h3>Propose a change</h3><p>Attach a source, preserve the intended diff, and anchor the candidate to its provenance.</p></div><div className="work-mini"><span>source verified</span><span>digest recorded</span><span>candidate created</span></div></article><article><b>2</b><div><h3>See what changes</h3><p>Screen for poisoning, replay behavior, and collect the exact evidence a reviewer needs.</p></div><div className="work-mini"><span>policy checks</span><span>behavior suite</span><span>evidence bound</span></div></article><article><b>3</b><div><h3>Promote with confidence</h3><p>Approval is bound to the digest. Promotion writes one new active revision—nothing else.</p></div><div className="work-mini"><span>human approval</span><span>atomic commit</span><span>audit event</span></div></article></div>
    </section>

    <footer className="vibe-footer"><Link href="/" className="vibe-brand"><ShieldCheck size={16} /> Stash</Link><p>Release control for AI-agent memory.</p><Link href="/overview">Open control plane <ArrowRight size={13} /></Link></footer>
  </main>;
}
