"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import JobForm from "@/components/jobs/JobForm";
import ApplicationChat from "@/components/jobs/ApplicationChat";
import { Card, Stat, Grid, Pill, Err, inp, muted, useDo, can, on } from "./ui";

const STAGES = ["new", "screening", "interview", "final", "offer", "hired", "rejected"], LABEL = { new: "New", screening: "Screening", interview: "Interview", final: "Final", offer: "Offer", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn" };

function Applicant({ id, appId, meta, onClose, reload }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(""); const [msg, setMsg] = useState(""); const [iv, setIv] = useState({ slots: ["", "", ""], link: "", mode: "video" });
  const load = useCallback(() => api.suite(id, "applicant", { applicationId: appId }).then(setD).catch((e) => setErr(e.message)), [id, appId]);
  useEffect(() => { load(); }, [load]);
  const { run, busy, err: aerr } = useDo(id, async () => { await load(); reload(); });
  if (err) return <Err>{err}</Err>; if (!d) return <Loading variant="cards" />;
  const s = d.snapshot;
  return (
    <Card title={s.name || "Candidate"} right={<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={onClose}>Close</button>} sub={`${d.job.title} · ${s.headline || ""}${s.identityVerified ? " · identity verified" : ""}`}>
      <Err>{aerr}</Err>
      <div className="flex gap-1.5 flex-wrap">{STAGES.map((st) => <button key={st} disabled={busy || !can(meta, "applicants.manage")} onClick={() => run({ action: "app.stage", applicationId: appId, stage: st })} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: d.stage === st ? C.mustard : "transparent", color: d.stage === st ? "#fff" : C.text2 }}>{LABEL[st]}</button>)}</div>
      {!d.pipelineFull && <div style={muted}>Screening, interview, final and offer stages, notes, messaging and scheduling are part of Business.</div>}
      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => run({ action: "app.rate", applicationId: appId, rating: d.rating === n ? 0 : n })} style={{ fontSize: 18, color: (d.rating || 0) >= n ? C.mustard : C.line, background: "none", border: "none", cursor: "pointer" }} aria-label={`Rate ${n}`}>★</button>)}</div>
      {(s.email || s.phone) && <div style={{ fontSize: 14, color: C.text }}>Contact they chose to share: {[s.email, s.phone].filter(Boolean).join(" · ")}</div>}
      {d.resume && <div><div className="lo-eyebrow">Resume</div><div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: C.text2, maxHeight: 260, overflow: "auto" }}>{d.resume}</div></div>}
      {d.coverLetter && <div><div className="lo-eyebrow">Cover letter</div><div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: C.text2 }}>{d.coverLetter}</div></div>}
      {d.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue, fontSize: 14 }}>{l}</a>)}
      {d.answers.map((a, i) => <div key={i} style={{ fontSize: 14, color: C.text }}><b>{a.q}</b><div style={{ color: C.text2 }}>{a.a}</div></div>)}
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{d.history.map((h) => `${h.label} ${String(h.at).slice(0, 10)}`).join(" → ")}</div>
      {d.pipelineFull && <>
        <div><div className="lo-eyebrow">Private notes</div>{d.notes.map((n) => <div key={n.id} style={{ fontSize: 13.5, color: C.text }}><b style={monoFont}>{n.by}</b> {n.body}</div>)}{can(meta, "applicants.manage") && <div className="flex gap-2 mt-1"><input style={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" /><button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={async () => { await run({ action: "app.note", applicationId: appId, body: note }); setNote(""); }}>Add</button></div>}</div>
        {can(meta, "applicants.message") && <ApplicationChat side="company" icsHref={(iid) => `/api/companies/${id}/suite?view=ics&interviewId=${iid}`} counterpart={s.name || "Candidate"} subtitle={`${d.job.title} · ${d.stageLabel}`} templates={d.templates} load={(since) => api.suite(id, "thread", { applicationId: appId, ...(since ? { since } : {}) }).then((r) => r.messages)} send={({ text, links, kind }) => api.suiteDo(id, { action: "app.message", applicationId: appId, body: text, links, kind }).then(() => { reload(); })} />}
        {can(meta, "interviews.manage") && <div><div className="lo-eyebrow">Interviews</div>{d.interviews.map((i) => <div key={i.id} style={{ fontSize: 14, color: C.text }}><Pill>{i.status.replace("_", " ")}</Pill> {i.chosen ? new Date(i.chosen).toUTCString() : i.slots.map((x) => new Date(x).toUTCString().slice(0, 22)).join(" | ")}{i.status === "confirmed" && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "interview.update", interviewId: i.id, act: "completed" })}>Mark done</button>}</div>)}
          <div className="flex flex-col gap-1 mt-1"><div style={muted}>Offer up to 3 times (your local time; the candidate sees theirs). A meeting link is yours to supply.</div>{iv.slots.map((s, k) => <input key={k} type="datetime-local" style={inp} value={s} onChange={(e) => setIv({ ...iv, slots: iv.slots.map((x, j) => (j === k ? e.target.value : x)) })} />)}<input style={inp} placeholder="Meeting link (https://…)" value={iv.link} onChange={(e) => setIv({ ...iv, link: e.target.value })} />
            <div><button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy || !iv.slots.some(Boolean)} onClick={() => run({ action: "interview.propose", applicationId: appId, slots: iv.slots.filter(Boolean).map((x) => new Date(x).toISOString()), link: iv.link, mode: iv.mode })}>Send invitation</button></div></div></div>}
      </>}
    </Card>
  );
}

function Pipeline({ id, meta, jobId, onBack }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [stage, setStage] = useState(null); const [open, setOpen] = useState(null);
  const load = useCallback(() => api.suite(id, "applicants", { jobId, ...(stage ? { stage } : {}) }).then(setD).catch((e) => setErr(e.message)), [id, jobId, stage]);
  useEffect(() => { load(); }, [load]);
  if (err) return <Err>{err}</Err>; if (!d) return <Loading variant="cards" />;
  return (
    <div className="flex flex-col gap-4">
      <Card title={d.job.title} right={<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={onBack}>← Jobs</button>} sub="Move candidates through the pipeline. Candidates are notified of each change.">
        <div className="flex gap-1.5 flex-wrap"><button onClick={() => setStage(null)} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: !stage ? C.mustard : "transparent", color: !stage ? "#fff" : C.text2 }}>All</button>{STAGES.map((s) => <button key={s} onClick={() => setStage(s)} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: stage === s ? C.mustard : "transparent", color: stage === s ? "#fff" : C.text2 }}>{LABEL[s]} {d.counts[s]}</button>)}</div>
        {d.applicants.length === 0 && <div style={muted}>No applicants here.</div>}
        {d.applicants.map((a) => <button key={a.id} onClick={() => setOpen(a.id)} className="lo-card text-left flex items-center gap-2 flex-wrap" style={{ padding: 12, cursor: "pointer" }}><b style={{ color: C.text }}>{a.name}</b><span style={{ color: C.text2, fontSize: 13.5 }}>{a.headline}</span><Pill>{a.stageLabel}</Pill>{a.identityVerified && <Pill color={C.green}>ID verified</Pill>}{a.unread > 0 && <Pill color={C.flag}>{a.unread} new</Pill>}<span style={{ marginLeft: "auto", color: C.mustard }}>{"★".repeat(a.rating || 0)}</span><span style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{a.applied}</span></button>)}
      </Card>
      {open && <Applicant id={id} appId={open} meta={meta} reload={load} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default function JobsTab({ id, meta }) {
  const [sel, setSel] = useState([]); const [csv, setCsv] = useState(""); const [imp, setImp] = useState(null); const [d, setD] = useState(null); const [err, setErr] = useState(null); const [mode, setMode] = useState(null); const [hist, setHist] = useState(null); const [rev, setRev] = useState(null); const [edit, setEdit] = useState(null);
  const load = useCallback(() => api.suite(id, "jobs").then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); if (can(meta, "hiring.insights")) api.suite(id, "hiring").then(setHist).catch(() => {}); }, [load, meta, id]);
  const { run, busy, err: aerr } = useDo(id, load);
  if (err) return <Err>{err}</Err>; if (!d) return <Loading variant="cards" />;
  if (mode?.pipeline) return <Pipeline id={id} meta={meta} jobId={mode.pipeline} onBack={() => setMode(null)} />;
  if (mode?.form) return <Card title={mode.edit ? "Edit job" : "New official job"} right={<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setMode(null)}>Cancel</button>}><JobForm viaCompany forWhom="my_company" companyId={id} companyName={meta.company.name} editId={mode.edit} initial={edit || {}} onSaved={() => { setMode(null); setEdit(null); load(); }} /></Card>;
  const T = d.totals;
  return (
    <div className="flex flex-col gap-4"><Err>{aerr}</Err>
      <Grid><Stat label="Active jobs" value={`${d.active} / ${d.limit}`} />{T && <><Stat label="Applications" value={T.applications} /><Stat label="Interviews" value={T.interviews} /><Stat label="Offers" value={T.offers} /><Stat label="Hires" value={T.hires} /></>}</Grid>
      {d.notVerified && <Card tone={C.mustard}><div style={{ fontSize: 14, color: C.text }}>Verify your company page to post official jobs. Until then, jobs can't be called official.</div></Card>}
      <Card title="Jobs" right={d.canPost && <button className="lo-btn lo-btn-primary lo-btn-sm" onClick={() => { setEdit(null); setMode({ form: true }); }}>New job</button>} sub="Official jobs are posted by your representatives and carry the Verified mark. You can pause, fill or close them; filled jobs stay as history.">
        {d.jobs.length === 0 && <div style={muted}>No jobs yet.</div>}
        {d.jobs.map((j) => <div key={j.id} style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10 }} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">{d.teams && <input type="checkbox" checked={sel.includes(j.id)} onChange={() => setSel(sel.includes(j.id) ? sel.filter((x) => x !== j.id) : [...sel, j.id])} aria-label="Select job" />}<Link href={`/jobs/${j.id}`} style={{ fontWeight: 700, color: C.text }}>{j.title}</Link>{j.team?.length > 0 && <Pill color={C.corpblue}>team of {j.team.length}</Pill>}<Pill color={j.status === "published" ? C.green : j.status === "review" ? C.flag : C.muted}>{j.status}</Pill><Pill color={j.transparency >= 65 ? C.green : C.mustard}>transparency {j.transparency}</Pill>{j.source !== "official" && <Pill color={C.mustard}>{j.awaiting ? "community, awaiting you" : j.sourceLabel}</Pill>}<span style={{ ...monoFont, fontSize: 11.5, color: C.muted, marginLeft: "auto" }}>{j.views30} views (30d) · {j.interested} interested · {j.age}</span></div>
          {j.funnel && <div style={{ fontSize: 13.5, color: C.text2 }}>Funnel: {j.funnel.applications} applied → {j.funnel.qualified} screened → {j.funnel.interviews} interviewed → {j.funnel.offers} offers → {j.funnel.hired} hired{j.views30 ? ` (${Math.round((j.funnel.applications / j.views30) * 100)}% of viewers applied)` : ""}</div>}
          {j.pipeline && !j.funnel && <div style={{ fontSize: 13.5, color: C.text2 }}>{Object.values(j.pipeline).reduce((a, b) => a + b, 0)} applications</div>}
          <div className="flex gap-1.5 flex-wrap">
            {can(meta, "applicants.view") && j.internalApply && <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => setMode({ pipeline: j.id })}>Applicants</button>}
            {can(meta, "jobs.post") && <>
              <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { const r = await api.suite(id, "job", { jobId: j.id }); setEdit({ ...r.job, salaryMin: r.job.salary_min, salaryMax: r.job.salary_max, salaryPeriod: r.job.salary_period, employmentType: r.job.employment_type, workplaceMode: r.job.workplace_mode, officeDays: r.job.office_days, hiringProcess: r.job.hiring_process, screeningQuestions: r.job.screening_questions, externalUrl: r.job.external_url, roleContext: r.job.role_context, applicationMethod: r.job.application_method, visa: !!r.job.visa_sponsorship, relocation: !!r.job.relocation, bonusEquity: r.job.bonus_equity }); setMode({ form: true, edit: j.id }); }}>Edit</button>
              {j.status === "published" && <><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "job.status", jobId: j.id, status: "paused" })}>Pause</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => confirm("Mark as filled? Applicants still in the process are told.") && run({ action: "job.status", jobId: j.id, status: "filled" })}>Filled</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => confirm("Close this job?") && run({ action: "job.status", jobId: j.id, status: "closed" })}>Close</button></>}
              {["paused", "draft", "closed", "expired"].includes(j.status) && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "job.status", jobId: j.id, status: "published" })}>{j.status === "draft" ? "Publish" : "Reopen"}</button>}
              {d.promoCap > 0 && j.status === "published" && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => run({ action: "job.promote", jobId: j.id, on: true, days: 14 })}>Promote 14 days</button>}
              {d.teams && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => { const h = prompt("Hiring team: representative handles, comma separated (empty = everyone with access)", (j.team || []).join(", ")); if (h !== null) run({ action: "job.team", jobId: j.id, handles: h.split(",").map((x) => x.trim()).filter(Boolean) }); }}>Hiring team</button>}
              {on(meta, "jobs_ai") && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => setRev({ id: j.id, ...(await run({ action: "job.review", jobId: j.id })) })}>Review wording</button>}</>}
          </div>
          {rev?.id === j.id && <div style={{ background: C.surface2, borderRadius: 12, padding: 10, fontSize: 13.5, color: C.text }}>{rev.tips?.length ? rev.tips.map((t, i) => <div key={i}>• {t}</div>) : "Nothing to improve."}{rev.ai && <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{rev.ai}</div>}</div>}
        </div>)}
        {!d.pipelineFull && <div style={muted}>Free pages get an inbox of applicants (new, hired, not selected). Pipeline stages, notes, messaging and interview scheduling are part of Business.</div>}
      </Card>
      {d.promoCap > 0 && <div style={muted}>Promoted jobs appear in a separate slot above search results, labelled “Promoted”. They don't rank higher in the normal list, and need a transparency score of 65+. Up to {d.promoCap} at a time.</div>}
      {d.teams && <Card title="Bulk actions and CSV import" sub="Select jobs above to pause, reopen or close them together. Or import many jobs as drafts from CSV.">
        <div className="flex gap-2 flex-wrap">{["paused", "published", "closed"].map((st) => <button key={st} className="lo-btn lo-btn-secondary lo-btn-sm" disabled={!sel.length || busy} onClick={async () => { const r = await run({ action: "job.bulk", ids: sel, status: st }); if (r) { setSel([]); setImp(`${r.ok} updated${r.failed.length ? `, ${r.failed.length} skipped: ${r.failed.join("; ")}` : ""}`); } }}>{st === "published" ? "Reopen" : st === "paused" ? "Pause" : "Close"} {sel.length || ""} selected</button>)}</div>
        <textarea rows={4} style={inp} placeholder={"title,department,location,mode,type,level,salaryMin,salaryMax,currency,period,description,applyUrl\nBackend Engineer,Engineering,Nairobi,hybrid,full_time,mid,180000,260000,KES,month,Build and run our payments platform…,"} value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div><button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={busy || csv.length < 20} onClick={async () => { const r = await run({ action: "job.import", csv }); if (r) { setImp(`${r.created} drafts created. ${r.note}${r.failed.length ? " Problems: " + r.failed.join("; ") : ""}`); setCsv(""); } }}>Import as drafts</button></div>{imp && <div style={{ fontSize: 13.5, color: C.text2 }}>{imp}</div>}</Card>}
      {d.claimable.length > 0 && <Card title="Jobs that mention your company" sub="Someone posted these. If they're really yours, claim them to make them official."><div className="flex flex-col gap-1">{d.claimable.map((c) => <div key={c.id} className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}>{c.title} <span style={{ color: C.muted }}>{c.ago}</span><button className="lo-btn lo-btn-secondary lo-btn-sm" style={{ marginLeft: "auto" }} onClick={() => run({ action: "job.claim", jobId: c.id })}>Claim</button></div>)}</div></Card>}
      {hist && <Card title="Hiring history (12 months)" sub="From your official jobs and, when there are 5+ answers, anonymous candidate feedback.">
        <Grid><Stat label="Jobs posted" value={hist.posted} /><Stat label="Filled" value={hist.filled} /><Stat label="Avg days to fill" value={hist.avgDaysToFill} /><Stat label="Avg applications / job" value={hist.avgApplications} /><Stat label="Hire rate" value={hist.hireRate != null ? `${hist.hireRate}%` : "—"} /><Stat label="Avg job transparency" value={hist.transparencyAvg} /></Grid>
        {hist.repeated.length > 0 && <div style={{ fontSize: 14, color: C.text }}>Roles opened repeatedly: {hist.repeated.map((r) => `${r.title} (${r.n}×)`).join(", ")}</div>}
        {hist.growth != null && <div style={{ fontSize: 14, color: C.text }}>Hiring {hist.growth >= 0 ? "growth" : "decline"}: {hist.growth > 0 ? "+" : ""}{hist.growth}% vs the previous 6 months.</div>}
        {hist.survey?.ready ? <div style={{ fontSize: 14, color: C.text }}>Candidate experience ({hist.survey.responses} answers): communicated clearly {hist.survey.communicated ?? "—"}% · ghosted {hist.survey.ghosted ?? "—"}% · role matched advert {hist.survey.matched ?? "—"}% · respectful {hist.survey.respectful ?? "—"}%</div> : <div style={muted}>{hist.survey?.note}</div>}
      </Card>}
    </div>
  );
}
