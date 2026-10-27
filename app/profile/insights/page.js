"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Eye, Lock, BarChart3 } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import ErrorNote from "@/components/ErrorNote";
import VerifiedTick from "@/components/VerifiedTick";

const ago = (iso) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

function Stat({ label, value }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "12px 14px", flex: 1, minWidth: 120 }}>
      <div style={{ ...displayFont, fontSize: 22, fontWeight: 800, color: C.text }}>{value}</div>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// Who viewed your profile + profile analytics. What you see depends on your plan,
// and viewers are only ever shown by their public pseudonym — never real identity.
export default function InsightsPage() {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => { fetch("/api/profile/views").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); }).catch((e) => setErr(e.message)); }, []);
  const max = Math.max(1, ...(d?.daily || []).map((x) => x.views));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/profile" style={{ ...monoFont, fontSize: 12, color: C.muted, textDecoration: "none" }}><ChevronLeft size={13} style={{ display: "inline" }} /> Profile</Link>
      <h1 style={{ ...displayFont, fontSize: 22, fontWeight: 800, color: C.text }}>Profile insights</h1>
      {err && <ErrorNote>{err}</ErrorNote>}
      {!d && !err && <div className="lo-skeleton" style={{ height: 160 }} />}
      {d?.locked && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 20 }} className="flex flex-col gap-3 items-start">
          <Lock size={18} color={C.muted} />
          <div style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>See who viewed your profile</div>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>OUT+ shows recent visitors. OUT PRO shows everyone, plus full profile analytics. Visitors appear by pseudonym only, in keeping with how Linkedout protects identity.</p>
          <Link href="/premium" style={{ ...monoFont, fontSize: 12, fontWeight: 700, color: "#fff", background: C.mustard, borderRadius: 8, padding: "8px 14px", textDecoration: "none" }}>See plans</Link>
        </div>
      )}
      {d && !d.locked && (
        <>
          <div className="flex gap-3 flex-wrap">
            <Stat label="Views · 7 days" value={d.views7d} />
            <Stat label="Unique visitors · 7 days" value={d.uniqueViewers7d} />
            {d.tier === "pro" && <Stat label="Views · 30 days" value={d.views30d ?? 0} />}
          </div>
          {d.tier === "pro" ? (
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 }}>
              <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 10 }}><BarChart3 size={13} /> Views per day · last 30 days</div>
              {d.daily?.length ? (
                <div className="flex items-end gap-1" style={{ height: 90 }}>
                  {d.daily.map((x) => <div key={x.day} title={`${x.day}: ${x.views}`} style={{ flex: 1, minWidth: 3, height: `${Math.max(6, (x.views / max) * 100)}%`, background: alpha(C.mustard, 80), borderRadius: 3 }} />)}
                </div>
              ) : <div style={{ fontSize: 13, color: C.muted }}>No views yet.</div>}
            </div>
          ) : (
            <div style={{ background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 30)}`, borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: C.text }}>
              Showing your 5 most recent visitors. <Link href="/premium" style={{ color: C.mustard, fontWeight: 700 }}>OUT PRO</Link> shows everyone and adds analytics.
            </div>
          )}
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
            <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted, padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}><Eye size={13} /> Recent visitors</div>
            {d.viewers.length === 0 && <div style={{ padding: 18, fontSize: 13, color: C.muted }}>No visitors yet. Posting more often is the fastest way to get noticed.</div>}
            {d.viewers.map((v, i) => (
              <Link key={i} href={v.handle ? `/u/${v.handle}` : "#"} className="flex items-center justify-between" style={{ padding: "11px 14px", textDecoration: "none", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <span className="inline-flex items-center" style={{ fontSize: 13.5, fontWeight: 600, color: C.text }}>{v.pseudonym}<VerifiedTick tier={v.tier} size={14} /></span>
                <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{ago(v.at)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
