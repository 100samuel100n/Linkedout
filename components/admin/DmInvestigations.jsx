"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { btn, card, inputStyle, Pill } from "./ui";
import Select from "@/components/ui/Select";

// Super-admin-only. Reading private messages is a serious step, so: a case
// reference + written reason is REQUIRED for every search and every conversation
// opened, nothing is browsable without a filter, and each use is written to the
// audit log (who, why, which filters, how many results).
export default function DmInvestigations() {
  const [c, setC] = useState({ caseRef: "", reason: "" });
  const [f, setF] = useState({ participant: "", conversationId: "", keyword: "", from: "", to: "", status: "", reportedOnly: "" });
  const [res, setRes] = useState(null), [view, setView] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v))).toString();
  const ready = c.caseRef.trim().length >= 3 && c.reason.trim().length >= 15;
  const hasFilter = Object.values(f).some(Boolean);

  async function search() {
    setBusy(true); setErr(""); setView(null);
    try { const d = await adminApi.get(`dminvestigations?${qs({ ...c, ...f })}`); setRes(d); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function open(id) {
    setBusy(true); setErr("");
    try { setView(await adminApi.get(`dminvestigations/${id}?${qs(c)}`)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const field = (k, label, ph, type = "text") => <label style={{ fontSize: 12, color: C.muted }}>{label}<input type={type} placeholder={ph} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ ...inputStyle, marginTop: 4 }} /></label>;

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ ...displayFont, fontSize: 24, margin: "0 0 6px" }}>DM Investigations</h1>
      <div style={{ ...card, borderColor: C.mustard, marginBottom: 14, fontSize: 13, lineHeight: 1.55 }}>
        <b>Restricted access.</b> You are about to read users' private messages. Every search and every conversation you open is recorded in the audit log with your case reference and reason. Only use this for safety, legal or abuse investigations, and make sure your Privacy Policy discloses that staff may review messages in these cases.
      </div>
      <div style={{ ...card, marginBottom: 14, display: "grid", gap: 10 }}>
        <label style={{ fontSize: 12, color: C.muted }}>Case / ticket reference (required)<input value={c.caseRef} onChange={(e) => setC({ ...c, caseRef: e.target.value })} placeholder="e.g. LEGAL-2026-014 or T-3F9A1C" style={{ ...inputStyle, marginTop: 4 }} /></label>
        <label style={{ fontSize: 12, color: C.muted }}>Why do you need access? (required, min. 15 characters)<textarea rows={2} value={c.reason} onChange={(e) => setC({ ...c, reason: e.target.value })} style={{ ...inputStyle, marginTop: 4 }} /></label>
      </div>
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Filters — set at least one</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {field("participant", "Participant (handle or account ID)", "e.g. maya_okafor")}
          {field("conversationId", "Conversation ID", "")}
          {field("keyword", "Message contains (searches the latest 400 messages per conversation)", "")}
          {field("from", "Active from", "", "date")}{field("to", "Active until", "", "date")}
          <label style={{ fontSize: 12, color: C.muted }}>Status<Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} style={{ ...inputStyle, marginTop: 4 }}><option value="">Any</option><option>active</option><option>pending</option><option>declined</option></Select></label>
          <label style={{ fontSize: 12, color: C.muted, display: "flex", gap: 8, alignItems: "center", marginTop: 20 }}><input type="checkbox" checked={f.reportedOnly === "1"} onChange={(e) => setF({ ...f, reportedOnly: e.target.checked ? "1" : "" })} />Only conversations with abuse reports</label>
        </div>
        <button style={{ ...btn("primary"), marginTop: 12, padding: "8px 16px" }} disabled={!ready || !hasFilter || busy} onClick={search}>{busy ? "Searching…" : "Search conversations"}</button>
        {!ready && <span style={{ fontSize: 12, color: C.muted, marginLeft: 10 }}>Fill in the case reference and reason first.</span>}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {res?.note && <p style={{ color: C.muted }}>{res.note}</p>}
      {res?.results && !view && (
        <div style={{ ...card, padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{["Participants", "Status", "Messages", "Reports", "Last activity", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 12, color: C.muted, borderBottom: `1px solid ${C.line}`, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
            <tbody>
              {res.results.length === 0 && <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: C.muted }}>No conversations match.</td></tr>}
              {res.results.map((r) => <tr key={r.id} style={{ borderBottom: `1px solid ${C.line}` }}><td style={{ padding: "8px 12px" }}>{r.a} ↔ {r.b}</td><td style={{ padding: "8px 12px" }}><Pill>{r.status}</Pill></td><td style={{ padding: "8px 12px" }}>{r.messages}</td><td style={{ padding: "8px 12px", color: r.reports ? C.flag : C.muted }}>{r.reports}</td><td style={{ padding: "8px 12px" }}>{r.last}</td><td style={{ padding: "8px 12px", textAlign: "right" }}><button style={btn()} onClick={() => open(r.id)}>Open conversation</button></td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {view && (
        <div>
          <button style={{ ...btn(), marginBottom: 10 }} onClick={() => setView(null)}>← Back to results</button>
          <h2 style={{ ...displayFont, margin: "0 0 10px" }}>{view.title} <Pill>{view.status}</Pill></h2>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(260px,1fr)", gap: 12 }}>
            <div style={{ ...card, display: "grid", gap: 8, maxHeight: "65vh", overflowY: "auto" }}>
              {view.thread.length === 0 && <span style={{ color: C.muted }}>No messages.</span>}
              {view.thread.map((m, i) => (
                <div key={i} style={{ justifySelf: m.kind === "a" ? "start" : "end", maxWidth: "80%", background: m.kind === "a" ? C.paper : C.corpblue + "22", border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px" }}>
                  <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{m.who} · {m.at}</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.body}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
              {view.blocks.map((b) => <div key={b.title} style={card}><div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>{b.title}</div>{b.rows.map(([k, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, padding: "3px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}><span style={{ color: C.muted }}>{k}</span><span style={{ textAlign: "right", wordBreak: "break-word" }}>{v}</span></div>)}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
