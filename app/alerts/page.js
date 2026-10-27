"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, Trash2, Lock } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";

export default function Alerts() {
  const { user, loading } = useAuth();
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = () => api.getSavedSearches().then(setD).catch((e) => setErr(e.message));
  useEffect(() => { if (user) load(); }, [user]);
  if (loading) return <Loading variant="cards" />;
  if (!user) return <div className="lo-card" style={{ padding: 24 }}><Link href="/login" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Log in</Link></div>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Saved searches" title="Alerts" subtitle="Save a search on the Stories page (a company, category, format or keyword) and get a notification when a new story matches." />
      {err && <ErrorNote>{err}</ErrorNote>}
      {d && d.limit === 0 && <div className="lo-card" style={{ padding: 18, fontSize: 14.5, color: C.text }}><Lock size={14} style={{ display: "inline", marginRight: 6 }} />Saved searches and alerts are part of <Link href="/premium" style={{ color: C.mustard, fontWeight: 650 }}>OUT+</Link> (5 searches) and OUT PRO (25).</div>}
      {!d && !err && <Loading variant="cards" />}
      {d?.searches.length === 0 && d.limit > 0 && <div className="lo-card" style={{ padding: 18, color: C.muted }}>Nothing saved yet. Open <Link href="/" style={{ color: C.mustard }}>Stories</Link>, filter, and tap “Save this search”.</div>}
      {d?.searches.map((s) => (
        <div key={s.id} className="lo-card flex items-center gap-3 flex-wrap" style={{ padding: 14 }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 650, color: C.text }}>{s.label}</div><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{Object.entries(s.query).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div></div>
          <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { await api.toggleSavedSearchAlerts(s.id, !s.alerts); load(); }}>{s.alerts ? <><Bell size={14} /> Alerts on</> : <><BellOff size={14} /> Alerts off</>}</button>
          <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={async () => { await api.deleteSavedSearch(s.id); load(); }}><Trash2 size={14} /></button>
        </div>
      ))}
      {d && <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{d.searches.length} of {d.limit} saved</div>}
    </div>
  );
}
