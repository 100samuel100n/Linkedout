"use client";
import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Err, inp, muted, useDo, can, on } from "./ui";

export default function TeamTab({ id, meta, reload }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [invite, setInvite] = useState(null); const [role, setRole] = useState("communications"); const [audit, setAudit] = useState(null);
  const [st, setSt] = useState(null);
  const load = useCallback(() => api.suite(id, "team").then((x) => { setD(x); setSt(x.settings); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (on(meta, "audit_log") && can(meta, "audit.view")) api.suite(id, "audit").then((a) => setAudit(a.entries)).catch(() => {}); }, [id, meta]);
  const { run, busy, err: aerr } = useDo(id, async () => { await load(); reload?.(); });
  if (err) return <Err>{err}</Err>;
  if (!d || !st) return <Loading variant="cards" />;
  const mng = can(meta, "team.manage");
  return (
    <div className="flex flex-col gap-4">
      <Card title={`Representatives (${d.reps.length} of ${d.seats})`} sub="Representatives are shown to the public only as “verified company representative”. A role decides what they can do; none of them can see who wrote a story.">
        <Err>{aerr}</Err>
        {d.reps.map((r) => <div key={r.handle} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 14, color: C.text }}>
          <span style={monoFont}>{r.handle}{r.self ? " (you)" : ""}</span>
          {r.role === "owner" || !mng ? <Pill>{r.roleLabel}</Pill> : <select style={{ ...inp, width: "auto" }} value={r.role} onChange={(e) => run({ action: "rep.role", handle: r.handle, role: e.target.value })}>{d.roles.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>}
          {r.added && <span style={{ color: C.muted, fontSize: 12.5 }}>added {r.added}</span>}
          {mng && r.role !== "owner" && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto", color: C.flag }} onClick={() => confirm(`Remove ${r.handle}?`) && run({ action: "rep.remove", handle: r.handle })}>Remove</button>}</div>)}
        {mng && <div className="flex gap-2 flex-wrap items-center"><select style={{ ...inp, width: "auto" }} value={role} onChange={(e) => setRole(e.target.value)}>{d.roles.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
          <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy || d.reps.length >= d.seats} onClick={async () => { const r = await run({ action: "rep.invite", role }); if (r) setInvite(r); }}>Invite a representative</button>
          {d.reps.length >= d.seats && <span style={muted}>Seat limit reached for your plan.</span>}</div>}
        {invite && <div style={{ background: C.surface2, borderRadius: 10, padding: 10, ...monoFont, fontSize: 13, color: C.text }}>Share this code privately (3 days, one use, role: {invite.roleLabel}): <b>{invite.code}</b> <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => navigator.clipboard?.writeText(invite.code)}><Copy size={13} /></button><div style={{ color: C.muted, marginTop: 4 }}>They redeem it at /redeem-invite.</div></div>}
        {d.roles.length <= 2 && <div style={muted}>More roles (HR, Analyst, Executive, Response manager) are part of Business Pro.</div>}
      </Card>

      <Card title="Roles">{d.allRoles.map((r) => <div key={r.key} style={{ fontSize: 14, color: C.text }}><b>{r.label}.</b> <span style={{ color: C.text2 }}>{r.blurb}</span></div>)}</Card>

      {can(meta, "settings.manage") && <Card title="Response workflow">
        <div className="flex gap-3 flex-wrap items-center">
          <label style={{ fontSize: 14, color: C.text }}>Response target (hours) <input type="number" style={{ ...inp, width: 100, marginLeft: 8 }} value={st.slaHours} onChange={(e) => setSt({ ...st, slaHours: e.target.value })} /></label>
          {d.approvalMax > 0 ? <label style={{ fontSize: 14, color: C.text }}>Approvals needed before a reply goes public <select style={{ ...inp, width: "auto", marginLeft: 8 }} value={st.approvalLevels} onChange={(e) => setSt({ ...st, approvalLevels: Number(e.target.value) })}>{Array.from({ length: d.approvalMax + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? "None (reply directly)" : i}</option>)}</select></label> : <span style={muted}>Approval workflows are part of Business Pro.</span>}
          <button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={() => run({ action: "settings.save", ...st })}>Save</button></div>
        {d.approvalMax > 1 && <div style={muted}>Multi-level approval: each level needs a different person with approval rights.</div>}
      </Card>}

      {audit && <Card title="Audit log" sub="Every important action by your team and by LinkedOut staff.">
        <div style={{ maxHeight: 360, overflow: "auto" }}>{audit.map((a, i) => <div key={i} style={{ fontSize: 13.5, color: C.text, padding: "4px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}><span style={monoFont}>{a.who}</span> · {a.action}{a.detail ? ` · ${a.detail}` : ""} <span style={{ color: C.muted }}>{a.ago}</span></div>)}{!audit.length && <div style={muted}>Nothing yet.</div>}</div></Card>}
      {!on(meta, "audit_log") && <div style={muted}>The audit log is part of Business Pro.</div>}
    </div>
  );
}
