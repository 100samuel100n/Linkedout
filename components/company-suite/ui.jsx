"use client";
import { useState } from "react";
import Link from "next/link";
import { Lock as LockIcon } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { planFor, planLabel } from "@/lib/business-features";

export const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%", fontFamily: "inherit" };
export const h2 = { margin: 0, fontSize: 17, fontWeight: 730, color: C.text };
export const muted = { fontSize: 13, color: C.muted, lineHeight: 1.5 };

export function Card({ title, right, children, tone, sub }) {
  return (
    <section className="lo-card flex flex-col gap-3" style={{ padding: 16, ...(tone ? { borderColor: alpha(tone, 45) } : {}) }}>
      {(title || right) && <div className="flex items-center gap-2 flex-wrap"><h2 style={h2}>{title}</h2><span style={{ marginLeft: "auto" }} className="flex gap-2 items-center">{right}</span></div>}
      {sub && <div style={muted}>{sub}</div>}
      {children}
    </section>
  );
}
export function Stat({ label, value, sub, tone }) {
  return <div style={{ background: C.surface2, borderRadius: 12, padding: 12 }}><div className="lo-eyebrow">{label}</div><div style={{ fontSize: 24, fontWeight: 760, color: tone || C.text }}>{value ?? "—"}</div>{sub && <div style={{ fontSize: 12, color: C.muted }}>{sub}</div>}</div>;
}
export const Grid = ({ min = 150, children }) => <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 10 }}>{children}</div>;
export function Pill({ children, color = C.muted }) {
  return <span style={{ ...monoFont, fontSize: 11, color, border: `1px solid ${alpha(color, 45)}`, background: alpha(color, 10), borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{children}</span>;
}
export function Bar({ value, color = C.mustard }) {
  return <div style={{ background: C.surface2, borderRadius: 99, height: 8, overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, height: "100%", background: color }} /></div>;
}
// Shown where the plan doesn't include a tool: says which plan does, and links to the comparison.
export function Locked({ id, feature, what }) {
  const need = planFor(feature, false) || planFor(feature);
  return (
    <Card>
      <div className="flex gap-3 items-start"><LockIcon size={18} color={C.muted} style={{ marginTop: 3, flexShrink: 0 }} />
        <div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.55 }}><b>{what}</b> is part of {planLabel(need)}{need !== "enterprise" ? " and above" : ""}.
          <div style={{ marginTop: 8 }}><Link href={`/companies/${id}/dashboard?tab=plan`} className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }}>Compare plans</Link></div></div></div>
    </Card>
  );
}
// Run an action against the suite API, reload afterwards, and keep an error to show.
export function useDo(id, after) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const run = async (body) => { setBusy(true); setErr(null); try { const r = await api.suiteDo(id, body); if (after) await after(r); return r; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); } };
  return { run, busy, err, setErr };
}
export const Err = ({ children }) => (children ? <div style={{ fontSize: 13.5, color: C.flag, background: alpha(C.flag, 10), border: `1px solid ${alpha(C.flag, 35)}`, borderRadius: 10, padding: "8px 12px" }}>{children}</div> : null);
export const Row = ({ children, gap = 2 }) => <div className="flex items-center flex-wrap" style={{ gap: gap * 4 }}>{children}</div>;
export const can = (meta, perm) => meta.perms.includes(perm);
export const lv = (meta, f) => meta.features[f];
export const on = (meta, f) => !!meta.features[f];
// 0-100 → colour
export const scoreColor = (s) => (s == null ? C.muted : s >= 80 ? C.green : s >= 65 ? C.corpblue : s >= 50 ? C.mustard : C.flag);
