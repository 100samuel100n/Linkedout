"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Lock } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";

export default function Analytics() {
  const { user, loading } = useAuth();
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [locked, setLocked] = useState(false);
  useEffect(() => { if (user) api.getStoryAnalytics().then(setD).catch((e) => (e.code === "PLAN_REQUIRED" ? setLocked(true) : setErr(e.message))); }, [user]);
  if (loading) return <Loading variant="cards" />;
  if (!user) return <div className="lo-card" style={{ padding: 24 }}><Link href="/login" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Log in</Link></div>;
  if (locked) return <div className="lo-card" style={{ padding: 22, fontSize: 14.5, color: C.text }}><Lock size={14} style={{ display: "inline", marginRight: 6 }} />Creator analytics and exports are part of <Link href="/premium" style={{ color: C.mustard, fontWeight: 650 }}>OUT PRO</Link>.</div>;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <Loading variant="cards" />;
  const max = Math.max(1, ...d.series.map((x) => x.views));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="OUT PRO" title="Story analytics" subtitle="Counts only. Nobody who viewed or reacted is ever identifiable." actions={<span className="flex gap-2"><a className="lo-btn lo-btn-secondary lo-btn-sm" href="/api/exports/stories?kind=analytics&format=csv"><Download size={14} /> Analytics CSV</a><a className="lo-btn lo-btn-secondary lo-btn-sm" href="/api/exports/stories?kind=stories&format=json"><Download size={14} /> All my stories</a></span>} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>{[["Stories", d.totals.stories], ["Views", d.totals.views], ["“Me too”", d.totals.meToo], ["Tracking", d.totals.tracking], ["Updates", d.totals.updates]].map(([l, v]) => <div key={l} className="lo-card" style={{ padding: 14 }}><div className="lo-eyebrow">{l}</div><div style={{ fontSize: 26, fontWeight: 760, color: C.text }}>{v ?? 0}</div></div>)}</div>
      <section className="lo-card" style={{ padding: 16 }}>
        <div className="lo-eyebrow" style={{ marginBottom: 8 }}>Views, last 30 days</div>
        <div className="flex items-end gap-1" style={{ height: 90 }} role="img" aria-label="Daily views">{d.series.map((x) => <div key={x.day} title={`${x.day}: ${x.views}`} style={{ flex: 1, height: `${Math.max(3, (x.views / max) * 100)}%`, background: C.mustard, borderRadius: 3, opacity: x.views ? 1 : 0.25 }} />)}</div>
      </section>
      <section className="lo-card" style={{ padding: 16, overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13.5, color: C.text, borderCollapse: "collapse", minWidth: 520 }}>
          <thead><tr style={{ ...monoFont, fontSize: 11.5, color: C.muted, textAlign: "left" }}>{["Story", "Views", "Me too", "Same co.", "Tracking", "Updates"].map((h) => <th key={h} style={{ padding: "6px 8px" }}>{h}</th>)}</tr></thead>
          <tbody>{d.stories.map((s) => <tr key={s.id} style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: "8px" }}><Link href={`/stories/${s.id}`} style={{ color: C.text, textDecoration: "none" }}>{s.title}</Link></td><td style={{ padding: 8 }}>{s.views}</td><td style={{ padding: 8 }}>{s.meToo}</td><td style={{ padding: 8 }}>{s.sameCompany}</td><td style={{ padding: 8 }}>{s.tracking}</td><td style={{ padding: 8 }}>{s.updates}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
