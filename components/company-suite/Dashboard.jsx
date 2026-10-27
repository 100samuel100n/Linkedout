"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Lock } from "lucide-react";
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

// The Company Command Center. Five pillars (Reputation, Response, Intelligence, Improvement, Employer) as tabs.
const TABS = [
  ["overview", "Reputation", Overview, null], ["stories", "Stories", StoriesInbox, null], ["alerts", "Alerts", AlertsTab, "alerts"],
  ["insights", "Insights", InsightsTab, "insights"], ["improve", "Improve", ImproveTab, "improvement"], ["employer", "Employer", EmployerTab, null],
  ["team", "Team", TeamTab, null], ["reports", "Reports", ReportsTab, "reports_basic"], ["plan", "Plan", PlanTab, null],
];
export default function Dashboard({ id }) {
  const sp = useSearchParams(); const router = useRouter(); const { user, loading } = useAuth();
  const [meta, setMeta] = useState(null); const [err, setErr] = useState(null);
  const tab = TABS.some((t) => t[0] === sp.get("tab")) ? sp.get("tab") : "overview";
  const load = useCallback(() => api.suite(id, "meta").then(setMeta).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { if (!loading) { if (!user) setErr("Log in to open your company dashboard."); else load(); } }, [id, load, user, loading]);
  const go = (t) => router.replace(`/companies/${id}/dashboard?tab=${t}`, { scroll: false });
  if (err && !meta) return <div className="flex flex-col gap-3"><ErrorNote>{err}</ErrorNote><Link href={`/companies/${id}`} style={{ color: C.corpblue }}>Back to the company page</Link></div>;
  if (!meta) return <Loading variant="cards" />;
  const Active = TABS.find((t) => t[0] === tab)[2];
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/companies/${id}`} className="inline-flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 13.5 }}><ChevronLeft size={15} /> Company page</Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 style={{ margin: 0, fontSize: 25, fontWeight: 770, color: C.text, letterSpacing: "-0.02em" }}>{meta.company.name} <span style={{ color: C.muted, fontWeight: 500 }}>Command Center</span></h1>
        <span style={{ ...monoFont, fontSize: 11.5, color: C.corpblue, border: `1px solid ${alpha(C.corpblue, 45)}`, borderRadius: 999, padding: "2px 10px" }}>{PLAN_LABELS[meta.plan]} · {meta.roleLabel}</span>
        {!meta.company.verified && <span style={{ ...monoFont, fontSize: 11.5, color: C.mustard }}>Page not verified yet</span>}
      </div>
      <nav className="flex gap-1.5 flex-wrap" aria-label="Company dashboard">{TABS.map(([k, label, , feat]) => {
        const locked = feat && !meta.features[feat];
        return <button key={k} onClick={() => go(k)} className="lo-btn lo-btn-sm" style={{ background: tab === k ? C.mustard : "transparent", color: tab === k ? "#fff" : C.text2, border: `1px solid ${tab === k ? C.mustard : C.line}` }}>{label}{locked && <Lock size={11} style={{ marginLeft: 5, display: "inline" }} />}</button>;
      })}</nav>
      <div style={{ background: alpha(C.corpblue, 8), border: `1px solid ${alpha(C.corpblue, 30)}`, borderRadius: 12, padding: "9px 14px", fontSize: 13.5, color: C.text }}><b>What a plan can never buy.</b> Removing, hiding, editing or ranking stories, or seeing who wrote them. You see each story exactly as the public does.</div>
      <Active id={id} meta={meta} go={go} reload={load} />
    </div>
  );
}
