"use client";
// Replies to a story, shaped by what the author asked for (Support / Advice / Warn others / Find others who experienced this).
// Backend: lib/stories/responses.js. Everyone appears under an alias; personal details in replies are redacted like in stories.
import { useCallback, useEffect, useState } from "react";
import { C, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";

const ago = (iso) => { const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${Math.floor(m)}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

export default function StoryResponses({ id }) {
  const { user } = useAuth();
  const [data, setData] = useState(null), [kind, setKind] = useState("support"), [text, setText] = useState(""), [anon, setAnon] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [filter, setFilter] = useState("all"), [replyTo, setReplyTo] = useState(null);
  const load = useCallback(() => api.storyResponses(id).then((d) => { setData(d); setKind((k) => (d.kinds.some((x) => x.key === k) ? k : (d.requested[0] || d.kinds[0]?.key || "reply"))); }).catch(() => setData({ kinds: [], responses: [], counts: {}, requested: [] })), [id]);
  useEffect(() => { load(); }, [load]);
  if (!data) return null;
  const labelOf = (k) => data.kinds.find((x) => x.key === k)?.label || ({ reply: "Reply" }[k] || k);
  const cur = data.kinds.find((x) => x.key === kind);
  async function send() {
    setBusy(true); setErr("");
    try { await api.addStoryResponse(id, { kind, body: text, parentId: replyTo, mode: anon ? "anon" : "alias" }); setText(""); setReplyTo(null); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(rid) { try { await api.removeStoryResponse(id, rid); await load(); } catch (e) { setErr(e.message); } }
  const shown = data.responses.filter((r) => filter === "all" || r.kind === filter);
  const chip = (on) => ({ border: `1px solid ${on ? C.mustard : C.line}`, background: on ? alpha(C.mustard, 14) : "transparent", color: on ? C.text : C.muted, borderRadius: 999, padding: "5px 12px", fontSize: 13, cursor: "pointer" });
  return (
    <section style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 16 }} aria-label="Replies">
      <h3 style={{ margin: "0 0 4px", fontSize: 16, color: C.text }}>Replies</h3>
      {data.requested.length > 0 && <p style={{ margin: "0 0 10px", color: C.muted, fontSize: 13.5 }}>The author is looking for: {data.requested.map(labelOf).join(", ")}.</p>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button style={chip(filter === "all")} onClick={() => setFilter("all")}>All ({data.responses.length})</button>
        {data.kinds.filter((k) => k.key !== "reply").map((k) => <button key={k.key} style={chip(filter === k.key)} onClick={() => setFilter(k.key)}>{k.label}{data.counts[k.key] ? ` (${data.counts[k.key]})` : ""}</button>)}
      </div>
      {shown.length === 0 && <p style={{ color: C.muted, fontSize: 14 }}>No replies yet. Be the first.</p>}
      <div style={{ display: "grid", gap: 10 }}>
        {shown.map((r) => (
          <div key={r.id} style={{ marginLeft: r.parentId ? 22 : 0, background: C.surface2, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 12.5, color: C.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <b style={{ color: C.text }}>{r.author}</b>{r.byStoryAuthor && <span style={{ color: C.mustard }}>author</span>}<span>{labelOf(r.kind)}</span><span>{ago(r.createdAt)}</span>
            </div>
            <div style={{ color: C.text, fontSize: 14.5, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.body}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 12, fontSize: 12.5 }}>
              {user && <button style={{ all: "unset", cursor: "pointer", color: C.muted }} onClick={() => { setReplyTo(r.id); setKind("reply"); }}>Reply</button>}
              {r.mine && <button style={{ all: "unset", cursor: "pointer", color: C.muted }} onClick={() => remove(r.id)}>Delete</button>}
            </div>
          </div>
        ))}
      </div>
      {user ? (
        <div style={{ marginTop: 14 }}>
          {!replyTo && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>{data.kinds.map((k) => <button key={k.key} style={chip(kind === k.key)} onClick={() => setKind(k.key)}>{k.label}</button>)}</div>}
          {replyTo && <div style={{ fontSize: 13, color: C.muted, marginBottom: 6 }}>Replying to a comment · <button style={{ all: "unset", cursor: "pointer", color: C.mustard }} onClick={() => setReplyTo(null)}>cancel</button></div>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder={cur?.prompt || "Write a reply"} style={{ width: "100%", boxSizing: "border-box", background: C.surface, color: C.text, border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, fontSize: 14.5 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: C.muted }}><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Post as a one-off anonymous name</label>
            <button disabled={busy || text.trim().length < 2} onClick={send} style={{ marginLeft: "auto", background: C.mustard, color: "#fff", border: 0, borderRadius: 10, padding: "9px 16px", fontWeight: 700, cursor: "pointer", opacity: busy || text.trim().length < 2 ? 0.6 : 1 }}>{busy ? "Posting…" : "Post reply"}</button>
          </div>
          {err && <p style={{ color: C.red || "#d33", fontSize: 13 }}>{err}</p>}
        </div>
      ) : <p style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>Log in to reply.</p>}
    </section>
  );
}
