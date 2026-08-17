"use client";

import {
  Activity, Bot, ChevronDown, Database, FileClock, GitPullRequestArrow, Menu,
  Search, Settings, ShieldCheck, TestTubeDiagonal, X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useWorkspace } from "../lib/workspace-provider";

const navigation = [
  { href: "/overview", label: "Overview", icon: Activity },
  { href: "/changes", label: "Changes", icon: GitPullRequestArrow },
  { href: "/memory", label: "Memory", icon: Database },
  { href: "/evaluations", label: "Evaluations", icon: TestTubeDiagonal },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/audit", label: "Audit", icon: FileClock },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { workspace, state } = useWorkspace();
  const workspaceName = workspace?.workspaceName ?? "Connecting workspace";
  const connectionLabel = state === "ready" ? "Workspace connected" : state === "error" ? "Workspace unavailable" : "Connecting workspace";
  const initials = workspaceName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "…";
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`} aria-label="Primary navigation">
        <div className="brand-row">
          <Link href="/overview" className="brand" onClick={() => setOpen(false)}>
            <span className="brand-mark" aria-hidden="true">S</span>
            <span>Stash</span>
          </Link>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X size={19} /></button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">{initials}</span>
          <span><strong>{workspaceName}</strong><small>{state === "ready" ? "Workspace session ready" : state === "error" ? "Workspace unavailable" : "Connecting"}</small></span>
          <ChevronDown size={15} aria-hidden="true" />
        </div>
        <nav className="nav-list">
          {navigation.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href as Route} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon size={17} strokeWidth={1.9} /><span>{item.label}</span>
            </Link>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/onboarding" className="nav-link"><ShieldCheck size={17} />Setup</Link>
          <Link href="/settings" className="nav-link"><Settings size={17} />Settings</Link>
          <div className="environment-card"><span className="live-dot" /><span>Runtime status</span><small>{connectionLabel}</small></div>
        </div>
      </aside>
      {open ? <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} /> : null}
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setOpen(true)}><Menu size={20} /></button>
          <div className="global-search"><Search size={16} aria-hidden="true" /><span>Search memory, changes, agents…</span><kbd>⌘ K</kbd></div>
          <div className="topbar-actions"><span className={`status-chip ${state === "ready" ? "good" : state === "error" ? "risk" : "pending"}`}><span />{connectionLabel}</span><span className="avatar">{initials}</span></div>
        </header>
        <main className="page-shell">{children}</main>
      </div>
    </div>
  );
}
