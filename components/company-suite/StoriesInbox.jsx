"use client";
import { useCallback, useEffect, useState } from "react";
import { Flag, UserCheck, Sparkles, ShieldCheck, FileText, X } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Err, inp, muted, useDo, can, on, lv } from "./ui";

const FILTERS = [["all", "All"], ["unanswered", "Unanswered"], ["answered", "Answered"], ["overdue", "Overdue"], ["review", "In review"], ["escalated", "Escalated"], ["mine", "Assigned to me"]];
const STATUS = { new: ["New", C.mustard], in_review: ["In review", C.corpblue], escalated: ["Escalated", C.flag], closed: ["Closed", C.muted], answered: ["Answered", C.green] };

function StoryPanel({ id, meta, storyId, onClose, onChange, team }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [text, setText] = useState(""); const [draftId, setDraftId] = useState(null); const [note, setNote] = useState(""); const [tone, setTone] = useState(null);
  const [edit, setEdit] = useState(null); const [dispute, setDispute] = useState(null); const [aiNote, setAiNote] = useState(null);
  const load = useCallback(() => api.suite(id, "story", { storyId }).then(setD).catch((e) => setErr(e.message)), [id, storyId]);
  useEffect(() => { setD(null); load(); }, [load]);
  const { run, busy, err: aerr } = useDo(id, async () => { await load(); onChange(); });
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  const s = d.story, ib = d.inbox, gated = d.approvalRequired;
  const approved = d.drafts.find((x) => x.status === "approved");
  const paid = on(meta, "response_mgmt") && lv(meta, "response_mgmt") !== "basic";
  const act = (action, extra = {}) => run({ action, storyId, ...extra });
  return (
    <Card title={s.format} right={<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={onClose} aria-label="Close"><X size={15} /></button>}>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{s.who} · {s.ago} · {s.views} views</div>
      {s.title && <div style={{ fontWeight: 700, color: C.text }}>{s.title}</div>}
      <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, color: C.text, lineHeight: 1.55 }}>{s.body}</div>
      {(s.told || s.actual) && <div style={{ fontSize: 13.5, color: C.text2 }}>{s.told && <div><b>Told:</b> {s.told}</div>}{s.actual && <div><b>Actually:</b> {s.actual}</div>}</div>}
      <div className="flex gap-1.5 flex-wrap">{s.themes.map((t) => <Pill key={t.key}>{t.label}</Pill>)}</div>
      <Err>{aerr}</Err>

      {paid && <div className="flex gap-2 flex-wrap items-center" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        {can(meta, "story.assign") && <>
          <select style={{ ...inp, width: "auto" }} value={ib.assignedTo || ""} onChange={(e) => act("story.assign", { handle: e.target.value || null })}><option value="">Unassigned</option>{team.map((r) => <option key={r.handle} value={r.handle}>{r.handle} · {r.roleLabel}</option>)}</select>
          <select style={{ ...inp, width: "auto" }} value={ib.priority || "normal"} onChange={(e) => act("story.priority", { priority: e.target.value })}>{["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}</select>
        </>}
        {ib.due && <Pill color={new Date(ib.due) < new Date() && !d.replies.length ? C.flag : C.muted}>due {ib.due.slice(0, 10)}</Pill>}
        {can(meta, "note.write") && <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy} onClick={() => act("story.review", { on: !ib.review })}><UserCheck size={13} /> {ib.review ? "Clear internal review" : "Mark for internal review"}</button>}
        {can(meta, "escalate") && !ib.escalated && <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy} onClick={() => act("story.escalate", { note })}><Flag size={13} /> Escalate</button>}
        {ib.escalated && <Pill color={C.flag}>Escalated</Pill>}
      </div>}

      {on(meta, "case_mgmt") && can(meta, "case.manage") && <div style={{ background: C.surface2, borderRadius: 12, padding: 12 }}>
        {ib.caseNo ? <div className="flex flex-col gap-2"><div className="flex items-center gap-2 flex-wrap"><b style={monoFont}>Case {ib.caseNo}</b>
          <select style={{ ...inp, width: "auto" }} value={ib.caseStatus || "investigating"} onChange={(e) => act("case.update", { status: e.target.value })}>{["investigating", "awaiting_response", "resolved", "closed"].map((x) => <option key={x}>{x}</option>)}</select></div>
          <textarea rows={2} style={inp} defaultValue={ib.resolution || ""} placeholder="Resolution (private)" onBlur={(e) => e.target.value !== (ib.resolution || "") && act("case.update", { resolution: e.target.value })} /></div>
          : <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy} onClick={() => act("case.open")}><FileText size={13} /> Open a case</button>}
      </div>}

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }} className="flex flex-col gap-2">
        <div className="lo-eyebrow">Your public replies</div>
        {d.replies.length === 0 && <div style={muted}>No public reply yet.</div>}
        {d.replies.map((r) => <div key={r.id} style={{ background: C.surface2, borderRadius: 12, padding: 10 }}>
          {edit?.id === r.id ? <><textarea rows={3} style={inp} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            <div className="flex gap-2 mt-2"><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await act("reply.edit", { responseId: r.id, body: edit.body })) setEdit(null); }}>Save</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setEdit(null)}>Cancel</button></div></>
            : <><div style={{ fontSize: 14, color: C.text, whiteSpace: "pre-wrap" }}>{r.body}</div>
              <div className="flex gap-2 items-center mt-1" style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{r.ago}{r.edited ? " · edited" : ""}
                {can(meta, "reply.edit") && r.canEdit && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setEdit({ id: r.id, body: r.body })}>Edit (24h)</button>}
                {can(meta, "reply.edit") && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={() => confirm("Delete your reply? The story stays.") && act("reply.delete", { responseId: r.id })}>Delete</button>}</div></>}
        </div>)}
      </div>

      {(can(meta, "reply.publish") || can(meta, "draft.write")) && <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        <div className="lo-eyebrow">Write a reply</div>
        <div style={muted}>Replies appear beside the story, labelled as the company. They never replace it, and the author is never told or shown who replied.</div>
        {d.templates.length > 0 && <select style={inp} value="" onChange={(e) => { const t = d.templates.find((x) => x.id === e.target.value); if (t) setText(t.body); }}><option value="">Insert a template…</option>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>}
        <textarea rows={5} style={inp} value={text} onChange={(e) => { setText(e.target.value); setTone(null); }} placeholder="Acknowledge the experience, say what you're doing, and say where people can raise it." />
        <div className="flex gap-2 flex-wrap">
          {on(meta, "ai_reply") && <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy} onClick={async () => { const r = await act("ai.suggest"); if (r) { setText(r.text); setAiNote(r.note); } }}><Sparkles size={13} /> Suggest a reply</button>}
          {on(meta, "response_pro") && <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy || !text.trim()} onClick={async () => setTone(await act("ai.tone", { body: text }))}><ShieldCheck size={13} /> Check tone</button>}
          {paid && <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy || text.trim().length < 10} onClick={async () => { const r = await act("draft.save", { id: draftId, body: text }); if (r) setDraftId(r.id); }}>Save draft</button>}
          {paid && can(meta, "draft.write") && text.trim().length >= 10 && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => act("template.save", { title: text.slice(0, 40), body: text })}>Save as template</button>}
          {can(meta, "reply.publish") && !gated && <button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy || text.trim().length < 10} onClick={async () => { if (await act("reply.publish", { body: text })) setText(""); }}>Publish reply</button>}
          {can(meta, "reply.publish") && gated && approved && <button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await act("reply.publish", { draftId: approved.id })) setText(""); }}>Publish approved draft</button>}
        </div>
        {aiNote && <div style={muted}>{aiNote}</div>}
        {tone && <div style={{ background: C.surface2, borderRadius: 12, padding: 10, fontSize: 13.5, color: C.text }}><b>Tone: {tone.rating}</b>{tone.issues.map((i, k) => <div key={k} style={{ marginTop: 4 }}>• {i.msg} <span style={{ color: C.muted }}>{i.fix}</span></div>)}{!tone.issues.length && <div>No issues found.</div>}</div>}
        {gated && <div style={muted}>This company requires an approved draft before anything goes public. Save a draft, submit it, and someone else approves it.</div>}
      </div>}

      {d.drafts.length > 0 && <div className="flex flex-col gap-2"><div className="lo-eyebrow">Drafts</div>{d.drafts.map((x) => <div key={x.id} style={{ background: C.surface2, borderRadius: 12, padding: 10 }}>
        <div style={{ fontSize: 14, color: C.text, whiteSpace: "pre-wrap" }}>{x.body}</div>
        <div className="flex gap-2 items-center flex-wrap mt-1" style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{x.by} · {x.ago} <Pill color={x.status === "approved" ? C.green : x.status === "rejected" ? C.flag : C.mustard}>{x.status}{x.status === "pending" ? ` ${x.approvals}/${x.needed}` : ""}</Pill>
          <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => { setText(x.body); setDraftId(x.id); }}>Use</button>
          {d.approvalRequired && ["draft", "rejected"].includes(x.status) && <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => act("draft.submit", { id: x.id })}>Submit for approval</button>}
          {x.status === "pending" && can(meta, "draft.approve") && <><button className="lo-btn lo-btn-primary lo-btn-sm" onClick={() => act("draft.decide", { id: x.id, decision: "approve" })}>Approve</button><button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={() => act("draft.decide", { id: x.id, decision: "reject", note: prompt("Why? (the author sees this)") || "" })}>Reject</button></>}
          <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => act("draft.delete", { id: x.id })}>Delete</button></div>
        {x.decisionNote && <div style={muted}>Reviewer: {x.decisionNote}</div>}</div>)}</div>}

      {on(meta, "internal_notes") && <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}><div className="lo-eyebrow">Private internal notes (never public)</div>
        {d.notes.map((n) => <div key={n.id} style={{ fontSize: 13.5, color: C.text, background: alpha(C.mustard, 8), borderRadius: 10, padding: "6px 10px" }}><b style={monoFont}>{n.by}</b> · {n.ago}<div>{n.body}</div></div>)}
        {can(meta, "note.write") && <div className="flex gap-2"><input style={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Likely relates to the Nairobi office. HR to look into it." /><button className="lo-btn lo-btn-secondary" disabled={busy || note.trim().length < 2} onClick={async () => { if (await act("story.note", { body: note })) setNote(""); }}>Add</button></div>}</div>}

      {d.similar?.length > 0 && <div className="flex flex-col gap-1" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}><div className="lo-eyebrow">Similar earlier stories</div>{d.similar.map((x) => <div key={x.id} style={{ fontSize: 13.5, color: C.text }}>• {x.excerpt} <span style={{ color: C.muted }}>({x.ago})</span>{x.ourReply && <div style={{ color: C.muted, marginLeft: 12 }}>Our reply then: “{x.ourReply}…”</div>}</div>)}</div>}
      {d.suggestedActions?.length > 0 && <div className="flex flex-col gap-1"><div className="lo-eyebrow">Suggested actions</div>{d.suggestedActions.map((a) => <div key={a} style={{ fontSize: 13.5, color: C.text }}>• {a}</div>)}</div>}

      {can(meta, "dispute.file") && <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        {!dispute ? <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setDispute({ reason: "", evidence: "" })}>Report a factual inaccuracy</button>
          : <div className="flex flex-col gap-2"><div style={muted}>A moderator reviews this. You can ask for a factual correction with evidence; you can't ask for removal because you dislike it. The story stays up while it's reviewed.</div>
            <input style={inp} placeholder="What is factually wrong? (one sentence)" value={dispute.reason} onChange={(e) => setDispute({ ...dispute, reason: e.target.value })} />
            <textarea rows={3} style={inp} placeholder="What you can show (dates, records, policy documents)…" value={dispute.evidence} onChange={(e) => setDispute({ ...dispute, evidence: e.target.value })} />
            <div className="flex gap-2"><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await act("dispute.file", dispute)) setDispute(null); }}>Submit for review</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setDispute(null)}>Cancel</button></div></div>}
      </div>}
    </Card>
  );
}

export default function StoriesInbox({ id, meta }) {
  const [filter, setFilter] = useState("unanswered"); const [q, setQ] = useState(""); const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null); const [team, setTeam] = useState([]);
  const load = useCallback(() => api.suite(id, "stories", { filter, q }).then(setD).catch((e) => setErr(e.message)), [id, filter, q]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { if (can(meta, "story.assign")) api.suite(id, "team").then((t) => setTeam(t.reps)).catch(() => {}); }, [id, meta]);
  if (err) return <Err>{err}</Err>;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Stories about your company" sub={d?.note || "Every story that mentions you. Who wrote it is never available to a company."}>
        <div className="flex gap-1.5 flex-wrap">{FILTERS.map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className="lo-btn lo-btn-sm" style={{ background: filter === k ? C.mustard : "transparent", color: filter === k ? "#fff" : C.text2, border: `1px solid ${filter === k ? C.mustard : C.line}` }}>{l}{d ? ` (${d.counts[k] ?? 0})` : ""}</button>)}</div>
        <input style={inp} placeholder="Search stories…" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>
      {!d ? <Loading variant="cards" /> : d.stories.length === 0 ? <Card><div style={muted}>Nothing here{filter !== "all" ? " for this filter" : " yet"}.</div></Card> : d.stories.map((s) => {
        const [lab, col] = STATUS[s.status] || STATUS.new;
        return (
          <div key={s.id} className="flex flex-col gap-3">
            <button onClick={() => setOpen(open === s.id ? null : s.id)} className="lo-card text-left" style={{ padding: 14, cursor: "pointer", borderColor: open === s.id ? C.mustard : undefined }}>
              <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 6 }}><Pill color={col}>{lab}</Pill><Pill>{s.format}</Pill>{s.overdue && <Pill color={C.flag}>overdue</Pill>}{s.priority !== "normal" && <Pill color={C.flag}>{s.priority}</Pill>}{s.caseNo && <Pill color={C.corpblue}>{s.caseNo}</Pill>}{s.assignedTo && <Pill>{s.assignedTo}</Pill>}<span style={{ ...monoFont, fontSize: 11.5, color: C.muted, marginLeft: "auto" }}>{s.who} · {s.ago}</span></div>
              <div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.5 }}>{s.excerpt}</div>
              {s.themes.length > 0 && <div className="flex gap-1.5 flex-wrap" style={{ marginTop: 8 }}>{s.themes.map((t) => <Pill key={t}>{t}</Pill>)}</div>}
            </button>
            {open === s.id && <StoryPanel id={id} meta={meta} storyId={s.id} team={team} onClose={() => setOpen(null)} onChange={load} />}
          </div>
        );
      })}
    </div>
  );
}
