"use client";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Trash2 } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Pill, Stat, Grid, Err, inp, muted, useDo, can, on } from "./ui";

// Everything on this tab is COMPANY-AUTHORED. It's shown publicly as "Company says", apart from anonymous stories.
function Save({ label = "Save", onClick, busy }) { return <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy} onClick={onClick}>{label}</button>; }

export default function EmployerTab({ id, meta }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const [faq, setFaq] = useState({}); const [prof, setProf] = useState({}); const [ann, setAnn] = useState({ title: "", body: "", kind: "update" });
  const [ans, setAns] = useState({}); const [show, setShow] = useState({ kind: "video", title: "", url: "" }); const [claim, setClaim] = useState({ topic: "", claim: "" });
  const load = useCallback(() => api.suite(id, "employer").then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const { run, busy, err: aerr } = useDo(id, load);
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  const val = (st, k, base) => (st[k] !== undefined ? st[k] : base);
  return (
    <div className="flex flex-col gap-4">
      <Err>{aerr}</Err>
      {!meta.company.verified && <Card tone={C.mustard}><div style={{ fontSize: 14, color: C.text }}>Official announcements, answers and job-claims are published once your company page is verified.</div></Card>}

      <Card title="How you appear publicly" sub="Labels only, and only once there is enough data. Candidates see this next to “Company says” and “People report”.">
        <div className="flex gap-2 flex-wrap items-center">
          <Pill color={C.corpblue}>Reputation health: {d.signals.health?.label || "not shown yet"}</Pill>
          <Pill color={C.corpblue}>Response: {d.signals.response?.label || "not shown yet"}</Pill>
          {d.signals.badges.map((b) => <Pill key={b.key} color={C.green}><BadgeCheck size={11} style={{ display: "inline" }} /> {b.label}</Pill>)}</div>
      </Card>

      {d.brand && <Card title="Employer brand analytics" sub="Aggregate only.">
        <Grid><Stat label="Profile views (30d)" value={d.brand.profileViews30} sub={`${d.brand.profileViewsPrev30} the 30 days before`} /><Stat label="Story views (30d)" value={d.brand.storyViews30} /><Stat label="Talent interest" value={d.brand.talentInterest ?? "—"} sub={d.brand.talentInterestNote || "people interested in working here"} /><Stat label="Candidate questions" value={`${d.brand.questionsAnswered} answered`} sub={`${d.brand.questionsOpen} waiting`} /></Grid>
        <div style={muted}>Coming: {d.brand.soon.join(", ")}.</div></Card>}
      {!d.brand && on(meta, "talent_interest") && d.talentInterest !== undefined && <Card title="Talent interest"><Stat label="People interested in working here" value={d.talentInterest ?? "—"} sub={d.talentNote || "aggregate only"} /></Card>}

      <Card title="Candidate questions (Ask the Company)" sub="Answers are labelled “Company response”, never presented as employee testimony.">
        {d.questions.length === 0 && <div style={muted}>No questions yet. They appear here when candidates ask.</div>}
        {d.questions.map((q) => <div key={q.id} style={{ background: C.surface2, borderRadius: 12, padding: 10 }}>
          <div style={{ fontSize: 14, color: C.text }}><b>Q:</b> {q.question} <span style={{ color: C.muted }}>({q.ago})</span></div>
          {q.status === "answered" ? <div style={{ fontSize: 14, color: C.text2, marginTop: 4 }}><b>Company response:</b> {q.answer}</div>
            : can(meta, "qa.answer") && <div className="flex gap-2 mt-2"><input style={inp} placeholder="Your official answer" value={ans[q.id] || ""} onChange={(e) => setAns({ ...ans, [q.id]: e.target.value })} /><Save label="Answer" busy={busy} onClick={() => run({ action: "qa.answer", id: q.id, answer: ans[q.id] })} /><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "qa.answer", id: q.id, hide: true })}>Hide</button></div>}
        </div>)}
      </Card>

      <Card title="What we want candidates to know" sub="Shown publicly as “Company says”, beside what people report. Be specific: vague answers read as evasion.">
        {d.faq.map((f) => <div key={f.key} className="flex flex-col gap-1"><div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{f.label} <span style={{ fontWeight: 400, color: C.muted }}>{f.prompt}</span></div>
          <div className="flex gap-2"><textarea rows={2} style={inp} value={val(faq, f.key, f.answer)} onChange={(e) => setFaq({ ...faq, [f.key]: e.target.value })} disabled={!can(meta, "faq.edit")} />
            {can(meta, "faq.edit") && faq[f.key] !== undefined && faq[f.key] !== f.answer && <Save busy={busy} onClick={() => run({ action: "faq.save", topic: f.key, answer: faq[f.key] })} />}</div></div>)}
      </Card>

      <Card title="Official announcements" sub="Policy changes, benefits, offices, leadership, remote work, layoffs. Labelled “Official Company Announcement”.">
        {can(meta, "announce.publish") && <div className="flex flex-col gap-2"><div className="flex gap-2"><input style={inp} placeholder="Title" value={ann.title} onChange={(e) => setAnn({ ...ann, title: e.target.value })} /><select style={{ ...inp, width: 150 }} value={ann.kind} onChange={(e) => setAnn({ ...ann, kind: e.target.value })}>{d.announceKinds.map((k) => <option key={k}>{k}</option>)}</select></div>
          <textarea rows={3} style={inp} placeholder="What's changing, from when, and who to ask." value={ann.body} onChange={(e) => setAnn({ ...ann, body: e.target.value })} />
          <div><button className="lo-btn lo-btn-primary lo-btn-sm" disabled={busy} onClick={async () => { if (await run({ action: "announce.publish", ...ann })) setAnn({ title: "", body: "", kind: "update" }); }}>Publish</button></div></div>}
        {d.announcements.map((a) => <div key={a.id} className="flex gap-2 items-start" style={{ fontSize: 14, color: C.text }}><div><b>{a.title}</b> <Pill>{a.kind}</Pill> <span style={{ color: C.muted }}>{a.ago}</span><div style={{ color: C.text2 }}>{a.body}</div></div>
          {can(meta, "announce.publish") && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto", color: C.flag }} onClick={() => run({ action: "announce.delete", id: a.id })}><Trash2 size={13} /></button>}</div>)}
      </Card>

      <Card title="Employer profile" sub="Company-written. Official facts show as “Company-stated”, with a check mark once LinkedOut staff have verified them.">
        {d.sections.map((s) => <div key={s.key} className="flex flex-col gap-1"><div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{s.label}</div>
          <div className="flex gap-2"><textarea rows={2} style={inp} value={val(prof, s.key, s.body)} onChange={(e) => setProf({ ...prof, [s.key]: e.target.value })} disabled={!can(meta, "profile.edit")} />{can(meta, "profile.edit") && prof[s.key] !== undefined && prof[s.key] !== s.body && <Save busy={busy} onClick={() => run({ action: "profile.save", section: s.key, body: prof[s.key] })} />}</div></div>)}
        {d.lockedSections > 0 && <div style={muted}>{d.lockedSections} more sections (culture, leadership, benefits, offices, teams and more) are part of Business.</div>}
        <div className="lo-eyebrow" style={{ marginTop: 6 }}>Official facts</div>
        {d.facts.map((f) => { const k = `fact:${f.key}`; return <div key={f.key} className="flex items-center gap-2"><div style={{ width: 170, fontSize: 13.5, color: C.text }}>{f.label}</div><input style={inp} value={val(prof, k, f.body)} onChange={(e) => setProf({ ...prof, [k]: e.target.value })} disabled={!can(meta, "profile.edit")} />{f.verified && <Pill color={C.green}>verified</Pill>}{can(meta, "profile.edit") && prof[k] !== undefined && prof[k] !== f.body && <Save busy={busy} onClick={() => run({ action: "profile.save", section: k, body: prof[k] })} />}</div>; })}
      </Card>

      <Card title="What you advertise" sub="Publish a claim (e.g. “Flexible remote work”). People can say whether it matches their experience, and candidates see both. This is how job-claim consistency works.">
        {can(meta, "profile.edit") && <div className="flex gap-2 flex-wrap"><select style={{ ...inp, width: 240 }} value={claim.topic} onChange={(e) => setClaim({ ...claim, topic: e.target.value })}><option value="">Topic…</option>{d.claimTopics.map((t) => <option key={t}>{t}</option>)}</select><input style={inp} placeholder="e.g. Flexible remote work, two office days a week" value={claim.claim} onChange={(e) => setClaim({ ...claim, claim: e.target.value })} /><button className="lo-btn lo-btn-secondary" disabled={busy || !claim.topic} onClick={async () => { if (await run({ action: "claim.publish", ...claim })) setClaim({ topic: "", claim: "" }); }}>Publish claim</button></div>}
      </Card>

      {on(meta, "showcase") && <Card title="Employer showcase" sub="Life at the company: videos, tours, interviews, documents. Always labelled company-created, never mixed with stories. https links only.">
        {can(meta, "profile.edit") && <div className="flex gap-2 flex-wrap"><select style={{ ...inp, width: 130 }} value={show.kind} onChange={(e) => setShow({ ...show, kind: e.target.value })}>{d.showcaseKinds.map((k) => <option key={k}>{k}</option>)}</select><input style={inp} placeholder="Title" value={show.title} onChange={(e) => setShow({ ...show, title: e.target.value })} /><input style={inp} placeholder="https://…" value={show.url} onChange={(e) => setShow({ ...show, url: e.target.value })} /><button className="lo-btn lo-btn-secondary" disabled={busy} onClick={async () => { if (await run({ action: "showcase.add", ...show })) setShow({ kind: "video", title: "", url: "" }); }}>Add</button></div>}
        {d.showcase.map((s) => <div key={s.id} className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}><Pill>{s.kind}</Pill><a href={s.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue }}>{s.title}</a>{can(meta, "profile.edit") && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto", color: C.flag }} onClick={() => run({ action: "showcase.delete", id: s.id })}><Trash2 size={13} /></button>}</div>)}
      </Card>}
    </div>
  );
}
