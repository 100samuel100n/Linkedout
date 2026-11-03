"use client";
import { useCallback, useEffect, useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Err, inp, muted, useDo, can, on, Locked } from "./ui";

export default function AlertsTab({ id, meta }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [f, setF] = useState(null);
  const load = useCallback(() => api.suite(id, "alerts").then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const { run, busy, err: aerr } = useDo(id, load);
  if (!on(meta, "alerts")) return <Locked id={id} feature="alerts" what="Alerts" />;
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  const set = (k, v) => setF({ ...f, params: { ...f.params, [k]: v } });
  const needsTheme = ["topic_count", "trend"].includes(f?.kind), needsText = ["location", "department"].includes(f?.kind);
  const toggleRole = (r) => setF({ ...f, notifyRoles: f.notifyRoles.includes(r) ? f.notifyRoles.filter((x) => x !== r) : [...f.notifyRoles, r] });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Alerts" right={d.events.some((e) => e.unread) && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "alert.read" })}>Mark all read</button>} sub="Alerts describe counts and themes, never a person. Department and location alerts need at least 5 reporters, so they can't point at one individual.">
        {d.events.length === 0 ? <div style={muted}>Nothing has fired yet.</div> : d.events.map((e) => <div key={e.id} className="flex gap-2 items-start" style={{ fontSize: 14, color: C.text, opacity: e.unread ? 1 : 0.65 }}><Bell size={14} color={e.severity === "high" ? C.flag : C.muted} style={{ marginTop: 3, flexShrink: 0 }} /><div>{e.message}<div style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{e.at.slice(0, 16).replace("T", " ")}</div></div></div>)}
      </Card>
      <Card title={`Alert rules (${d.rules.length} of ${d.limit})`} right={can(meta, "alerts.manage") && !f && <button className="lo-btn lo-btn-primary lo-btn-sm" onClick={() => setF({ kind: d.kinds[0]?.kind, params: {}, notifyRoles: ["owner", "admin"] })}>New alert</button>}>
        <Err>{aerr}</Err>
        {d.rules.map((r) => <div key={r.id} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 14, color: C.text }}>
          <Pill color={r.enabled ? C.green : C.muted}>{r.enabled ? "on" : "off"}</Pill><b>{r.label}</b> {r.text}
          <span style={{ marginLeft: "auto" }} className="flex gap-1">{can(meta, "alerts.manage") && <><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "alert.toggle", id: r.id, on: !r.enabled })}>{r.enabled ? "Pause" : "Resume"}</button><button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={() => run({ action: "alert.delete", id: r.id })}><Trash2 size={13} /></button></>}</span></div>)}
        {d.rules.length === 0 && !f && <div style={muted}>No rules yet. Start with “3+ negative stories in 7 days”.</div>}
        {f && <div className="flex flex-col gap-2" style={{ background: "var(--lo-surface2)", borderRadius: 12, padding: 12 }}>
          <select style={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, params: {} })}>{d.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</select>
          <div style={muted}>{d.kinds.find((k) => k.kind === f.kind)?.blurb}</div>
          {needsTheme && <select style={inp} value={f.params.theme || "burnout"} onChange={(e) => set("theme", e.target.value)}>{d.themes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>}
          {needsText && <input style={inp} placeholder={f.kind === "location" ? "Location, e.g. Nairobi" : "Department, e.g. Engineering"} value={f.params.text || ""} onChange={(e) => set("text", e.target.value)} />}
          {["negative_burst", "topic_count", "location", "department"].includes(f.kind) && <div className="flex gap-2"><input style={inp} type="number" placeholder="How many stories" value={f.params.count || ""} onChange={(e) => set("count", e.target.value)} /><input style={inp} type="number" placeholder="Within how many days" value={f.params.days || ""} onChange={(e) => set("days", e.target.value)} /></div>}
          {f.kind === "trend" && <input style={inp} type="number" placeholder="Increase by at least (%)" value={f.params.pct || ""} onChange={(e) => set("pct", e.target.value)} />}
          {d.routing ? <div><div className="lo-eyebrow">Tell these roles</div><div className="flex gap-1.5 flex-wrap mt-1">{d.roles.map((r) => <button key={r.key} onClick={() => toggleRole(r.key)} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: f.notifyRoles.includes(r.key) ? C.mustard : "transparent", color: f.notifyRoles.includes(r.key) ? "#fff" : C.text2 }}>{r.label}</button>)}</div></div> : <div style={muted}>Alerts go to the owner and admins. Routing to HR, Communications and others is part of Business Pro.</div>}
          <div className="flex gap-2"><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await run({ action: "alert.save", ...f })) setF(null); }}>Save alert</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setF(null)}>Cancel</button></div>
        </div>}
      </Card>
      {d.kinds.length < 8 && <div style={muted}>Business Pro adds trend, location, department, industry-median and job-claim alerts, plus routing to roles.</div>}
    </div>
  );
}
