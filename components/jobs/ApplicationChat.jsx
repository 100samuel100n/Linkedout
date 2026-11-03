"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Link2, CalendarClock, FileText, Check, CheckCheck, ChevronDown, Zap } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";

const local = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const dayLabel = (iso) => { const d = new Date(iso), t = new Date(); const y = new Date(Date.now() - 864e5); const same = (a, b) => a.toDateString() === b.toDateString(); return same(d, t) ? "Today" : same(d, y) ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }); };
const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const initials = (s) => String(s || "?").replace(/^rep-/, "").slice(0, 2).toUpperCase();

function InterviewCard({ m, side, onInterview, icsHref }) {
  const i = m.interview; if (!i) return null;
  const tone = i.status === "confirmed" ? C.green : i.status === "cancelled" ? C.flag : C.mustard;
  return (
    <div style={{ border: `1px solid ${alpha(tone, 45)}`, background: alpha(tone, 8), borderRadius: 14, padding: 12, minWidth: 250 }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 14, color: C.text }}><CalendarClock size={16} color={tone} /> Interview · {i.duration} min · {i.mode}</div>
      <div style={{ ...monoFont, fontSize: 11, color: tone, textTransform: "uppercase", marginTop: 2 }}>{i.status.replace("_", " ")}</div>
      {i.status === "confirmed" && <div style={{ fontSize: 14, color: C.text, marginTop: 6 }}>{local(i.chosen)} · <a href={icsHref(i.id)} style={{ color: C.corpblue }}>Add to calendar</a>{i.link && <> · <a href={i.link} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue }}>Join link</a></>}</div>}
      {i.status === "proposed" && side === "candidate" && <div className="flex gap-1.5 flex-wrap mt-2">{i.slots.map((s) => <button key={s} className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => onInterview?.(i.id, "choose", s)}>{local(s)}</button>)}<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => onInterview?.(i.id, "reschedule")}>None work</button></div>}
      {i.status === "proposed" && side === "company" && <div style={{ fontSize: 13, color: C.text2, marginTop: 6 }}>Offered: {i.slots.map(local).join(" · ")}</div>}
      {i.status === "reschedule_requested" && <div style={{ fontSize: 13, color: C.text2, marginTop: 6 }}>Reschedule requested.</div>}
    </div>
  );
}

// A premium conversation: day dividers, grouped bubbles, read receipts, timeline events, interview and document-request cards,
// link attachments, quick-reply templates, optimistic send, and live refresh while the tab is visible.
export default function ApplicationChat({ side, load, send, templates = [], onInterview, counterpart, subtitle, canWrite = true, icsHref = () => "#" }) {
  const [msgs, setMsgs] = useState(null); const [text, setText] = useState(""); const [links, setLinks] = useState([]); const [linkIn, setLinkIn] = useState(""); const [showLink, setShowLink] = useState(false);
  const [showT, setShowT] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null); const [away, setAway] = useState(false); const [asReq, setAsReq] = useState(false);
  const box = useRef(null), last = useRef(null);
  const refresh = useCallback(async (full = false) => { try { const r = await load(full ? null : last.current); if (full) setMsgs(r); else if (r.length) setMsgs((m) => { const ids = new Set((m || []).filter((x) => !x.optimistic).map((x) => x.id)); return [...(m || []).filter((x) => !x.optimistic), ...r.filter((x) => !ids.has(x.id))]; }); } catch (e) { setErr(e.message); } }, [load]);
  useEffect(() => { refresh(true); }, [refresh]);
  useEffect(() => { if (msgs?.length) last.current = msgs.filter((m) => !m.optimistic).slice(-1)[0]?.at || last.current; }, [msgs]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") refresh(false); }, 8000); return () => clearInterval(t); }, [refresh]);
  useEffect(() => { const el = box.current; if (el && !away) el.scrollTop = el.scrollHeight; }, [msgs, away]);
  async function submit() {
    const t = text.trim(); if (!t || busy) return; setBusy(true); setErr(null);
    const tmp = { id: "tmp" + Date.now(), optimistic: true, mine: true, from: side, kind: asReq ? "request" : "text", body: t, links, at: new Date().toISOString(), seen: false };
    setMsgs((m) => [...(m || []), tmp]); setText(""); setLinks([]); setAsReq(false); setAway(false);
    try { await send({ text: t, links, kind: asReq ? "request" : "text" }); await refresh(true); } catch (e) { setErr(e.message); setMsgs((m) => (m || []).filter((x) => x.id !== tmp.id)); setText(t); } finally { setBusy(false); }
  }
  let prevDay = null, prevFrom = null;
  return (
    <div className="flex flex-col" style={{ border: `1px solid ${C.line}`, borderRadius: 18, overflow: "hidden", background: C.surface, height: 520, position: "relative" }}>
      <div className="flex items-center gap-3" style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, background: C.surface2 }}>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: C.mustard, color: "#fff", display: "grid", placeItems: "center", fontWeight: 760 }}>{initials(counterpart)}</div>
        <div className="min-w-0"><div style={{ fontWeight: 720, fontSize: 15, color: C.text }}>{counterpart}</div>{subtitle && <div style={{ fontSize: 12.5, color: C.muted }}>{subtitle}</div>}</div>
        <div style={{ ...monoFont, fontSize: 10.5, color: C.muted, marginLeft: "auto" }} className="hidden sm:block">Private to this application · encrypted at rest</div>
      </div>
      <div ref={box} onScroll={(e) => setAway(e.target.scrollHeight - e.target.scrollTop - e.target.clientHeight > 120)} style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }} className="flex flex-col" aria-live="polite">
        {!msgs ? <div style={{ color: C.muted, fontSize: 13.5 }}>Loading conversation…</div> : msgs.length === 0 ? <div style={{ margin: "auto", textAlign: "center", color: C.muted, fontSize: 14, maxWidth: 300 }}>No messages yet. {side === "company" ? "Say hello, ask a question, or send an interview invitation." : "The company will message you here."}</div> : msgs.map((m) => {
          const d = dayLabel(m.at), showDay = d !== prevDay, grouped = !showDay && prevFrom === m.from && m.kind !== "event"; prevDay = d; prevFrom = m.from;
          if (m.kind === "event") return <div key={m.id}>{showDay && <div style={{ ...monoFont, fontSize: 11, color: C.muted, textAlign: "center", margin: "12px 0 6px" }}>{d}</div>}<div style={{ textAlign: "center", margin: "8px 0" }}><span style={{ fontSize: 12.5, color: C.text2, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 12px" }}>{m.body} · {clock(m.at)}</span></div></div>;
          return (
            <div key={m.id}>
              {showDay && <div style={{ ...monoFont, fontSize: 11, color: C.muted, textAlign: "center", margin: "12px 0 6px" }}>{d}</div>}
              <div className="flex gap-2" style={{ justifyContent: m.mine ? "flex-end" : "flex-start", marginTop: grouped ? 2 : 10 }}>
                {!m.mine && <div style={{ width: 28, flexShrink: 0 }}>{!grouped && <div style={{ width: 28, height: 28, borderRadius: 14, background: C.surface2, border: `1px solid ${C.line}`, color: C.text2, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>{initials(m.who)}</div>}</div>}
                <div style={{ maxWidth: "78%" }}>
                  {!grouped && !m.mine && <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 2, marginLeft: 4 }}>{m.who}</div>}
                  {m.kind === "interview" ? <InterviewCard m={m} side={side} onInterview={onInterview} icsHref={icsHref} /> : (
                    <div style={{ background: m.mine ? C.mustard : C.surface2, color: m.mine ? "#fff" : C.text, borderRadius: 16, borderTopRightRadius: m.mine && !grouped ? 4 : 16, borderTopLeftRadius: !m.mine && !grouped ? 4 : 16, padding: "9px 13px", fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-wrap", opacity: m.optimistic ? 0.65 : 1, border: m.kind === "request" ? `1px dashed ${m.mine ? "#fff" : C.mustard}` : "none" }}>
                      {m.kind === "request" && <div className="flex items-center gap-1" style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.85, marginBottom: 3 }}><FileText size={13} /> Request</div>}
                      {m.body}
                      {m.links?.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1" style={{ marginTop: 6, fontSize: 13, color: m.mine ? "#fff" : C.corpblue, textDecoration: "underline", wordBreak: "break-all" }}><Link2 size={12} />{l.replace(/^https:\/\//, "").slice(0, 48)}</a>)}
                    </div>)}
                  <div className="flex items-center gap-1" style={{ justifyContent: m.mine ? "flex-end" : "flex-start", ...monoFont, fontSize: 10.5, color: C.muted, marginTop: 2, padding: "0 4px" }}>{clock(m.at)}{m.mine && !m.optimistic && (m.seen ? <><CheckCheck size={12} color={C.green} /> Seen</> : <Check size={12} />)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {away && <button onClick={() => { setAway(false); box.current.scrollTop = box.current.scrollHeight; }} className="lo-btn lo-btn-secondary lo-btn-sm" style={{ position: "absolute", right: 16, bottom: 92 }}><ChevronDown size={14} /> Latest</button>}
      {err && <div style={{ fontSize: 13, color: C.flag, padding: "4px 16px" }}>{err}</div>}
      {canWrite ? (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: 10, background: C.surface }}>
          {links.length > 0 && <div className="flex gap-1.5 flex-wrap" style={{ marginBottom: 6 }}>{links.map((l) => <span key={l} className="inline-flex items-center gap-1" style={{ fontSize: 12, background: C.surface2, borderRadius: 999, padding: "2px 10px", color: C.text2 }}><Link2 size={11} />{l.replace(/^https:\/\//, "").slice(0, 30)}<button onClick={() => setLinks(links.filter((x) => x !== l))} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted }}>×</button></span>)}</div>}
          {showLink && <div className="flex gap-2" style={{ marginBottom: 6 }}><input autoFocus style={{ flex: 1, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "7px 10px", fontSize: 13.5 }} placeholder="https://…" value={linkIn} onChange={(e) => setLinkIn(e.target.value)} /><button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => { if (/^https:\/\/[^\s]+$/.test(linkIn)) { setLinks([...links, linkIn]); setLinkIn(""); setShowLink(false); } }}>Attach</button></div>}
          {showT && templates.length > 0 && <div className="flex flex-col gap-1" style={{ marginBottom: 6, maxHeight: 130, overflowY: "auto" }}>{templates.map((t) => <button key={t.id} onClick={() => { setText(t.body); setShowT(false); }} className="lo-btn lo-btn-ghost lo-btn-sm text-left" style={{ justifyContent: "flex-start" }}><Zap size={12} /> {t.title}</button>)}</div>}
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1"><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setShowLink(!showLink)} aria-label="Attach a link"><Link2 size={16} /></button>{templates.length > 0 && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setShowT(!showT)} aria-label="Quick replies"><Zap size={16} /></button>}</div>
            <textarea rows={Math.min(5, Math.max(1, text.split("\n").length))} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey || !e.nativeEvent.isComposing)) { e.preventDefault(); submit(); } }} placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" style={{ flex: 1, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 14, padding: "9px 13px", fontSize: 14.5, resize: "none", fontFamily: "inherit" }} />
            <button className="lo-btn lo-btn-primary" disabled={busy || !text.trim()} onClick={submit} aria-label="Send"><Send size={16} /></button>
          </div>
          {side === "company" && <label style={{ fontSize: 12, color: C.muted, display: "inline-flex", gap: 6, marginTop: 6 }}><input type="checkbox" checked={asReq} onChange={(e) => setAsReq(e.target.checked)} /> Send as a document / information request</label>}
        </div>) : <div style={{ borderTop: `1px solid ${C.line}`, padding: 12, fontSize: 13, color: C.muted }}>Messaging opens when the company starts the conversation.</div>}
    </div>
  );
}
