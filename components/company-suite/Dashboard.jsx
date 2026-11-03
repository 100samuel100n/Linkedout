"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock, Menu } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { PLAN_LABELS } from "@/lib/business-features";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import Overview from "./Overview";
import StoriesInbox from "./StoriesInbox";
import AlertsTab from "./AlertsTab";
import InsightsTab from "./InsightsTab";
import ImproveTab from "./ImproveTab";
import EmployerTab from "./EmployerTab";
import TeamTab from "./TeamTab";
import ReportsTab from "./ReportsTab";
import PlanTab from "./PlanTab";
import EngageTab from "./EngageTab";
import ConnectTab from "./ConnectTab";
import JobsTab from "./JobsTab";

// The Company Command Center. Five pillars (Reputation, Response, Intelligence, Improvement, Employer) as tabs.
const GROUPS = [
  ["Reputation", [["overview", "Overview", Overview, null], ["stories", "Stories inbox", StoriesInbox, null]]],
  ["Intelligence", [["insights", "Insights", InsightsTab, "insights"], ["alerts", "Alerts", AlertsTab, "alerts"], ["reports", "Reports", ReportsTab, "reports_basic"]]],
  ["Improvement", [["improve", "Improve", ImproveTab, "improvement"]]],
  ["Employer & talent", [["jobs", "Jobs & hiring", JobsTab, null], ["employer", "Employer profile", EmployerTab, null], ["engage", "Events & pulse", EngageTab, null]]],
  ["Workspace", [["team", "Team & security", TeamTab, null], ["connect", "Integrations", ConnectTab, "api"], ["plan", "Plan & billing", PlanTab, null]]],
];
const TABS = GROUPS.flatMap(([, t]) => t);

// The Command Center is its own workspace: a persistent sidebar, a slim top bar, and a content area, with none of the feed's chrome.
export default function Dashboard({ id }) {
  const sp = useSearchParams(); const router = useRouter(); const { user, loading } = useAuth();
  const [meta, setMeta] = useState(null); const [err, setErr] = useState(null); const [open, setOpen] = useState(false);
  const tab = TABS.some((t) => t[0] === sp.get("tab")) ? sp.get("tab") : "overview";
  const load = useCallback(async () => { try { const m = await api.suite(id, "meta"); await api.suite(id, "team"); setMeta(m); } catch (e) { if (/single sign-on/i.test(e.message)) { setErr(e.message); setMeta(null); } else if (!meta) { try { setMeta(await api.suite(id, "meta")); } catch (e2) { setErr(e2.message); } } } }, [id]);
  useEffect(() => { if (!loading) { if (!user) setErr("Log in to open your company dashboard."); else load(); } }, [id, load, user, loading]);
  const go = (t) => { setOpen(false); router.replace(`/companies/${id}/dashboard?tab=${t}`, { scroll: false }); };
  const shell = { minHeight: "100vh", background: C.ink, color: C.text };
  if (err && /single sign-on/i.test(err)) return <div style={shell} className="flex"><div style={{ padding: 28, maxWidth: 520 }} className="flex flex-col gap-3"><h1 style={{ margin: 0, fontSize: 22, color: C.text }}>Sign in with your company</h1><div style={{ color: C.text2, lineHeight: 1.55 }}>{meta?.company?.name || "This company"} requires single sign-on for its dashboard. Sign in with your company account to continue.</div><a className="lo-btn lo-btn-primary" style={{ textDecoration: "none", alignSelf: "flex-start" }} href={`/api/companies/${id}/sso/start`}>Continue with company SSO</a><Link href="/" style={{ color: C.muted, fontSize: 13 }}>Back to LinkedOut</Link>{sp.get("ssoerror") && <ErrorNote>{sp.get("ssoerror")}</ErrorNote>}</div></div>;
  if (err && !meta) return <div style={shell} className="flex flex-col gap-3 items-start" ><div style={{ padding: 24 }} className="flex flex-col gap-3"><ErrorNote>{err}</ErrorNote><Link href={`/companies/${id}`} style={{ color: C.corpblue }}>Back to the company page</Link></div></div>;
  if (!meta) return <div style={{ ...shell, padding: 24 }}><Loading variant="cards" /></div>;
  const Active = TABS.find((t) => t[0] === tab)[2], label = TABS.find((t) => t[0] === tab)[1];
  const nav = (
    <nav aria-label="Company dashboard" className="flex flex-col gap-4" style={{ padding: "14px 10px" }}>
      {GROUPS.map(([g, items]) => (
        <div key={g}><div className="lo-eyebrow" style={{ padding: "0 10px 6px" }}>{g}</div>
          {items.map(([k, l, , feat]) => { const locked = feat && !meta.features[feat]; const on = tab === k;
            return <button key={k} onClick={() => go(k)} className="flex items-center w-full text-left" style={{ gap: 8, padding: "8px 10px", borderRadius: 10, fontSize: 14, fontWeight: on ? 700 : 500, color: on ? C.text : C.text2, background: on ? alpha(C.mustard, 14) : "transparent", border: "none", cursor: "pointer", borderLeft: `3px solid ${on ? C.mustard : "transparent"}` }}>{l}{locked && <Lock size={11} style={{ marginLeft: "auto", opacity: 0.6 }} />}</button>; })}
        </div>))}
    </nav>
  );
  return (
    <div style={shell} className="flex">
      <aside className="hidden md:flex flex-col" style={{ width: 252, flexShrink: 0, borderRight: `1px solid ${C.line}`, background: C.surface, position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
        <div style={{ padding: "18px 16px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: 780, fontSize: 16, color: C.text, lineHeight: 1.25 }}>{meta.company.name}</div>
          <div style={{ ...monoFont, fontSize: 11, color: C.corpblue, marginTop: 4 }}>{PLAN_LABELS[meta.plan]} · {meta.roleLabel}</div>
          {!meta.company.verified && <div style={{ ...monoFont, fontSize: 11, color: C.mustard, marginTop: 2 }}>Page not verified yet</div>}
        </div>
        {nav}
        <div style={{ marginTop: "auto", padding: 14, borderTop: `1px solid ${C.line}` }} className="flex flex-col gap-1"><Link href={`/companies/${id}`} style={{ color: C.text2, fontSize: 13, textDecoration: "none" }}>View public page</Link><Link href="/" style={{ color: C.muted, fontSize: 13, textDecoration: "none" }}>← Back to LinkedOut</Link></div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-3" style={{ position: "sticky", top: 0, zIndex: 20, padding: "12px 20px", background: alpha(C.ink, 92), backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}` }}>
          <button className="md:hidden lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setOpen(!open)} aria-label="Menu"><Menu size={18} /></button>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 740, color: C.text }}>{label}</h1>
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: C.muted }} className="hidden sm:block">What a plan can never buy: removing, hiding or editing stories, or seeing who wrote them.</span>
        </header>
        {open && <div className="md:hidden" style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}>{nav}<div style={{ padding: "0 14px 12px" }}><Link href={`/companies/${id}`} style={{ color: C.text2, fontSize: 13 }}>View public page</Link> · <Link href="/" style={{ color: C.muted, fontSize: 13 }}>Back to LinkedOut</Link></div></div>}
        <main style={{ padding: "22px 20px 60px", maxWidth: 1120, width: "100%", margin: "0 auto" }}><Active id={id} meta={meta} go={go} reload={load} /></main>
      </div>
    </div>
  );
}
