"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, Megaphone, Building2 } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";

// "Company says", always visually separate from "People report" (the stories and patterns below it).
// Everything here was written by the company, and is labelled that way.
const Tag = ({ children, color = C.corpblue }) => <span style={{ ...monoFont, fontSize: 10.5, color, border: `1px solid ${alpha(color, 45)}`, background: alpha(color, 10), borderRadius: 999, padding: "2px 8px" }}>{children}</span>;
const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 };
const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };

export default function OfficialSection({ companyId }) {
  const { user } = useAuth(); const [d, setD] = useState(null); const [q, setQ] = useState(""); const [msg, setMsg] = useState(null); const [mine, setMine] = useState(false);
  useEffect(() => { api.companyOfficial(companyId).then((x) => { setD(x); setMine(!!x.talentInterest?.mine); }).catch(() => {}); }, [companyId]);
  if (!d || !d.verified) return null;
  const has = d.faq.length || d.announcements.length || d.questions.length || d.sections.length || d.facts.length || d.showcase.length || d.signals.health || d.signals.response || d.signals.badges.length;
  async function ask() { try { await api.companyOfficialDo(companyId, { action: "ask", question: q }); setQ(""); setMsg("Sent. The company can answer publicly."); } catch (e) { setMsg(e.message); } }
  async function interest() { try { const r = await api.companyOfficialDo(companyId, { action: "interest" }); setMine(r.mine); } catch (e) { setMsg(e.message); } }
  return (
    <section className="flex flex-col gap-3" aria-label="What the company says">
      <div className="flex items-center gap-2 flex-wrap"><h2 style={{ margin: 0, fontSize: 18, fontWeight: 740, color: C.text }}>Company says</h2><Tag>Written by the company</Tag>
        {d.signals.health && <Tag color={C.muted}>Reputation health: {d.signals.health.label}</Tag>}
        {d.signals.response && <Tag color={C.muted}>{d.signals.response.label}{d.signals.response.rate != null ? ` · ${d.signals.response.rate}% of stories answered` : ""}</Tag>}
        {d.signals.badges.map((b) => <span key={b.key} title={b.criteria}><Tag color={C.green}><BadgeCheck size={10} style={{ display: "inline" }} /> {b.label}</Tag></span>)}</div>
      {d.signals.health && <div style={{ fontSize: 12.5, color: C.muted }}>{d.signals.health.note} Badges are earned from data, never bought.</div>}

      {d.announcements.length > 0 && <div style={box}>{d.announcements.map((a) => <div key={a.id} style={{ marginBottom: 10 }}><div className="flex items-center gap-2 flex-wrap"><Megaphone size={14} color={C.corpblue} /><b style={{ color: C.text }}>{a.title}</b><Tag>Official Company Announcement</Tag><span style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{a.ago}</span></div><div style={{ fontSize: 14.5, color: C.text2, whiteSpace: "pre-wrap", marginTop: 4 }}>{a.body}</div></div>)}</div>}

      {(d.facts.length > 0 || d.sections.length > 0) && <div style={box} className="flex flex-col gap-2">
        {d.facts.length > 0 && <div className="flex gap-x-5 gap-y-1 flex-wrap" style={{ fontSize: 14, color: C.text }}>{d.facts.map((f) => <span key={f.label}><span style={{ color: C.muted }}>{f.label}:</span> {f.value} {f.verified ? <BadgeCheck size={12} color={C.green} style={{ display: "inline" }} aria-label="Verified by LinkedOut" /> : <span style={{ fontSize: 11, color: C.muted }}>(company-stated)</span>}</span>)}</div>}
        {d.sections.map((s) => <div key={s.label}><div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}><Building2 size={13} style={{ display: "inline", marginRight: 6 }} />{s.label}</div><div style={{ fontSize: 14.5, color: C.text2, whiteSpace: "pre-wrap" }}>{s.body}</div></div>)}</div>}

      {d.faq.length > 0 && <div style={box}><div style={{ fontWeight: 740, color: C.text, marginBottom: 6 }}>What we want candidates to know <Tag>Company says</Tag></div>
        {d.faq.map((f) => <details key={f.label} style={{ borderTop: `1px solid ${C.line}`, padding: "8px 0" }}><summary style={{ cursor: "pointer", color: C.text, fontSize: 14.5 }}>{f.label}</summary><div style={{ fontSize: 14.5, color: C.text2, marginTop: 4, whiteSpace: "pre-wrap" }}>{f.answer}</div></details>)}
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>Compare with what people report, below.</div></div>}

      {d.showcase.length > 0 && <div style={box}><div style={{ fontWeight: 740, color: C.text, marginBottom: 6 }}>Life at the company <Tag>Company-created content</Tag></div>
        <div className="flex gap-2 flex-wrap">{d.showcase.map((s) => <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue, fontSize: 14 }}>{s.title} ({s.kind})</a>)}</div></div>}

      <div style={box} className="flex flex-col gap-2">
        <div style={{ fontWeight: 740, color: C.text }}>Ask the company</div>
        {d.questions.map((x) => <div key={x.id} style={{ fontSize: 14, color: C.text }}><div><b>Q:</b> {x.question}</div><div style={{ color: C.text2 }}><Tag>Company response</Tag> {x.answer}</div></div>)}
        {user ? <div className="flex gap-2"><input style={inp} placeholder="Ask about pay, hours, remote work, probation…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={400} /><button className="lo-btn lo-btn-secondary" disabled={q.trim().length < 10} onClick={ask}>Ask</button></div> : <div style={{ fontSize: 13, color: C.muted }}>Log in to ask a question. The company never sees who asked.</div>}
        {d.talentInterest?.enabled && user && <div><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={interest}>{mine ? "✓ You're interested in working here (tap to undo)" : "Interested in working here"}</button><div style={{ fontSize: 12, color: C.muted }}>The company sees only a total once at least 5 people have said so, never who.</div></div>}
        {msg && <div style={{ fontSize: 13, color: C.text2 }}>{msg}</div>}
      </div>
      {has && <div style={{ fontSize: 12.5, color: C.muted }}>Below: what people report. Anonymous stories are never edited, hidden or ranked by the company.</div>}
    </section>
  );
}
