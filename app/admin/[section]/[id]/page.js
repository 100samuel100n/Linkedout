"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "@/components/admin/adminApi";
import { useAdmin } from "@/components/admin/AdminContext";
import { Pill, card, btn, inputStyle } from "@/components/admin/ui";
import { Modal } from "@/components/admin/SectionTable";
import Select from "@/components/ui/Select";

// Individual report / appeal / DMCA / legal-request page. The server builds the
// whole view (/api/admin/<section>/<id>); this just renders it and runs actions.
export default function DetailPage({ params }) {
  const { section, id } = use(params);
  const me = useAdmin();
  const [d, setD] = useState(null), [err, setErr] = useState(""), [prompt, setPrompt] = useState(null), [val, setVal] = useState(""), [busy, setBusy] = useState(false), [reply, setReply] = useState("");
  const load = useCallback(() => adminApi.get(`${section}/${id}`).then(setD).catch((e) => setErr(e.message)), [section, id]);
  useEffect(() => { load(); }, [load]);
  const sec = me.sections.find((s) => s.id === section);
  if (!sec) return <p style={{ color: C.muted }}>Your role doesn't have access to this section.</p>;
  if (!d) return err ? <ErrorNote>{err}</ErrorNote> : <Loading />;

  async function run(a, input) {
    setBusy(true); setErr("");
    try { await adminApi.post(`${section}/${encodeURIComponent(id)}/${a.id}`, a.input ? { [a.input.key]: input } : {}); setPrompt(null); setVal(""); await load(); } 
    catch (e) { setErr(e.message); throw e; } finally { setBusy(false); }
  }
  return (
    <div style={{ maxWidth: 1000 }}>
      <Link href={`/admin/${section}`} style={{ color: C.muted, fontSize: 13, textDecoration: "none" }}>← {sec.label}</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0 14px" }}>
        <h1 style={{ ...displayFont, fontSize: 24, margin: 0 }}>{d.title} <Pill>{d.status}</Pill></h1>
        <div style={{ display: "flex", gap: 6 }}>
          {d.userId && <Link href="/admin/users" style={{ ...btn(), textDecoration: "none" }}>Open Users</Link>}
          {d.actions.filter((a) => !d.compose || !(["reply", "note"].includes(a.id))).map((a) => <button key={a.id + a.label} disabled={busy} style={btn(a.danger ? "danger" : "primary")} onClick={() => (a.input ? (setPrompt(a), setVal(a.input.options?.length ? a.input.options[0] : "")) : run(a).catch(() => {}))}>{a.label}</button>)}
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {d.thread && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>Conversation</div>
          <div style={{ display: "grid", gap: 8 }}>
            {d.thread.map((m, i) => (
              <div key={i} style={{ justifySelf: m.kind === "staff" ? "end" : "start", maxWidth: "88%", background: m.kind === "note" ? "#E8A31722" : m.kind === "staff" ? C.corpblue + "22" : C.paper, border: `1px solid ${m.kind === "note" ? C.mustard : C.line}`, borderRadius: 12, padding: "8px 12px" }}>
                <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{m.kind === "note" ? "🔒 Internal note · " : ""}{m.who} · {m.at}</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.body}</div>
              </div>
            ))}
          </div>
          {d.compose && d.actions.some((a) => a.id === "reply") && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              {d.macros?.length > 0 && <Select value="" onChange={(e) => { const m = d.macros.find((x) => x.id === e.target.value); if (m) setReply((r) => (r ? r + "\n\n" : "") + m.body); }} style={{ ...inputStyle, marginBottom: 8, maxWidth: 280 }}><option value="">Insert canned response…</option>{d.macros.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</Select>}
              <textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply — the user is notified." style={inputStyle} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                <button style={btn()} disabled={busy || !reply.trim()} onClick={() => run({ id: "note", input: { key: "body" } }, reply).then(() => setReply("")).catch(() => {})}>Save as internal note</button>
                <button style={btn("primary")} disabled={busy || !reply.trim()} onClick={() => run({ id: "reply", input: { key: "body" } }, reply).then(() => setReply("")).catch(() => {})}>Send reply</button>
              </div>
            </div>
          )}
        </div>
      )}
      {d.text && (
        <div style={{ ...card, marginBottom: 12 }}>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>{d.text.title}</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.55 }}>{d.text.body}</div>
          {d.text.note && <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}` }}><div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase" }}>{d.text.note.title}</div><div style={{ whiteSpace: "pre-wrap", fontSize: 13.5 }}>{d.text.note.body}</div></div>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
        {d.blocks.map((b) => (
          <div key={b.title} style={card}>
            <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", marginBottom: 6 }}>{b.title}</div>
            {b.rows.map(([k, v], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "3px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}><span style={{ color: C.muted }}>{k}</span><span style={{ textAlign: "right", wordBreak: "break-word" }}>{v}</span></div>)}
          </div>
        ))}
      </div>
      {d.tables?.map((t) => (
        <div key={t.title} style={{ ...card, marginTop: 12, padding: 0, overflow: "auto", maxHeight: "50vh" }}>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", padding: "10px 12px" }}>{t.title}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr>{t.columns.map((c) => <th key={c} style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, color: C.muted, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, textTransform: "uppercase", whiteSpace: "nowrap", position: "sticky", top: 0, background: C.surface }}>{c}</th>)}</tr></thead>
            <tbody>
              {t.rows.length === 0 && <tr><td colSpan={t.columns.length} style={{ padding: 18, color: C.muted, textAlign: "center" }}>Nothing yet.</td></tr>}
              {t.rows.map((r, i) => <tr key={i} style={{ borderBottom: `1px solid ${C.line}` }}>{r.map((v, j) => <td key={j} style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>{String(v ?? "")}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      ))}
      {prompt && (
        <Modal title={prompt.label} onClose={() => setPrompt(null)}>
          {prompt.input.options?.length
            ? <Select style={inputStyle} value={val} onChange={(e) => setVal(e.target.value)}>{prompt.input.options.map((o) => <option key={o}>{o}</option>)}</Select>
            : <textarea rows={3} style={inputStyle} value={val} placeholder={prompt.input.label} onChange={(e) => setVal(e.target.value)} />}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button style={btn()} onClick={() => setPrompt(null)}>Cancel</button>
            <button style={btn(prompt.danger ? "danger" : "primary")} disabled={busy || (!val.trim() && !prompt.input.optional)} onClick={() => run(prompt, val).catch(() => {})}>Confirm</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
