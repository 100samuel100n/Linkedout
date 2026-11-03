"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, Bookmark, Share2, Flag, Heart, Pencil } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import BeforeYouApply from "@/components/jobs/BeforeYouApply";
import { Chip } from "@/components/jobs/JobCardV2";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };
const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 };
const MODE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" }, TYPE = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary", freelance: "Freelance" };
const REASONS = { scam: "Scam", fake_company: "Fake company", impersonation: "Impersonation", misleading_salary: "Misleading salary", misleading_description: "Misleading description", expired: "Expired", duplicate: "Duplicate", recruitment_fee: "Recruitment fee", suspicious_link: "Suspicious external link", other: "Other" };
const List = ({ title, items }) => items?.length ? <section style={box}><h3 style={{ margin: "0 0 8px", fontSize: 16, color: C.text }}>{title}</h3><ul style={{ margin: 0, paddingLeft: 18, color: C.text2, fontSize: 14.5, lineHeight: 1.6 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></section> : null;

function ApplyPanel({ job, onDone }) {
  const [f, setF] = useState({ resumeText: "", coverLetter: "", links: "", email: "", answers: job.screeningQuestions.map(() => ""), shareName: true }); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  async function submit() { setBusy(true); setErr(null); try { await api.jobDo(job.id, { action: "apply", ...f, links: f.links.split("\n") }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <section style={{ ...box, borderColor: C.mustard }} className="flex flex-col gap-3" aria-label="Apply">
      <h2 style={{ margin: 0, fontSize: 18, color: C.text }}>Apply to {job.title}</h2>
      <div style={{ fontSize: 13.5, color: C.text2 }}>{job.company.name} receives what you enter here, your name (if you choose), and your headline. They contact you through LinkedOut messages. The employment relationship is between you and the company; LinkedOut only carries the application.</div>
      <label style={{ fontSize: 14, color: C.text }}><input type="checkbox" checked={f.shareName} onChange={(e) => setF({ ...f, shareName: e.target.checked })} /> Share my real name (otherwise they see my LinkedOut alias)</label>
      <label className="lo-btn lo-btn-secondary lo-btn-sm" style={{ alignSelf: "flex-start", cursor: "pointer" }}>Upload resume (PDF or Word, up to 5 MB)<input type="file" accept=".pdf,.doc,.docx,application/pdf" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setErr(null); try { const fd = new FormData(); fd.append("file", file); const r = await fetch("/api/jobs/resume", { method: "POST", body: fd, credentials: "include" }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "Couldn't read that file."); setF((x) => ({ ...x, resumeText: d.text, resumeName: file.name })); } catch (x) { setErr(x.message); } }} /></label>
      {f.resumeName && <div style={{ fontSize: 13, color: C.green }}>Read {f.resumeName}. Check the text below and edit anything that didn't come through.</div>}
      <textarea rows={7} style={inp} placeholder="Or paste your resume text (work history, education, skills)" value={f.resumeText} onChange={(e) => setF({ ...f, resumeText: e.target.value })} />
      <textarea rows={2} style={inp} placeholder="Portfolio / profile links (https://…), one per line" value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} />
      <textarea rows={4} style={inp} placeholder="Cover letter (optional)" value={f.coverLetter} onChange={(e) => setF({ ...f, coverLetter: e.target.value })} />
      <input style={inp} placeholder="Contact email (optional; they can also message you here)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      {job.screeningQuestions.map((q, i) => <div key={i}><div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>{q}</div><textarea rows={2} style={inp} value={f.answers[i]} onChange={(e) => setF({ ...f, answers: f.answers.map((a, k) => (k === i ? e.target.value : a)) })} /></div>)}
      {err && <ErrorNote>{err}</ErrorNote>}
      <div><button className="lo-btn lo-btn-primary" disabled={busy} onClick={submit}>Submit application</button></div>
    </section>
  );
}

export default function Page({ params }) {
  const { id } = use(params); const { user } = useAuth(); const router = useRouter();
  const [j, setJ] = useState(null); const [err, setErr] = useState(null); const [applying, setApplying] = useState(false); const [msg, setMsg] = useState(null); const [rep, setRep] = useState(null);
  const load = () => api.job(id).then(setJ).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <div className="flex flex-col gap-3"><ErrorNote>{err}</ErrorNote><Link href="/jobs" style={{ color: C.corpblue }}>Back to jobs</Link></div>;
  if (!j) return <Loading variant="cards" />;
  const act = async (a, extra = {}) => { if (!user) return router.push("/login"); try { const r = await api.jobDo(id, { action: a, ...extra }); await load(); return r; } catch (e) { setMsg(e.message); } };
  const app = j.mine?.application;
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 820, margin: "0 auto" }}>
      <Link href="/jobs" style={{ color: C.muted, fontSize: 13.5, textDecoration: "none" }}>← All jobs</Link>
      {j.status !== "published" && <div style={{ background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14, color: C.text }}>This job is {j.status === "filled" ? "filled" : j.status}. It stays here as a record, but it isn't taking applications.</div>}
      <section style={box} className="flex flex-col gap-2">
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 780, color: C.text }}>{j.title}</h1>
        <div style={{ fontSize: 15.5, color: C.text2 }}>{j.company.id ? <Link href={`/companies/${j.company.id}`} style={{ color: C.text2 }}>{j.company.name}</Link> : j.company.name} {j.company.verified && <BadgeCheck size={15} color={C.green} style={{ display: "inline" }} aria-label="Verified company" />}</div>
        <div style={{ fontSize: 14, color: C.text2 }}>{[j.locations.join(", "), MODE[j.mode], TYPE[j.type], j.seniority, j.department].filter(Boolean).join(" · ")}{j.mode === "hybrid" && j.officeDays != null ? ` (${j.officeDays} office days a week)` : ""}</div>
        <div style={{ fontSize: 20, fontWeight: 760, color: C.text }}>{j.salary || <span style={{ fontSize: 15, fontWeight: 400, color: C.muted }}>Salary not disclosed</span>}{j.bonusEquity && <span style={{ fontSize: 13.5, fontWeight: 400, color: C.text2 }}> + {j.bonusEquity}</span>}</div>
        <div className="flex gap-1.5 flex-wrap"><Chip color={j.verification === "verified" ? C.green : j.verification === "associated" ? C.corpblue : j.verification === "review" ? C.flag : C.muted}>{j.verificationLabel}</Chip><Chip>{j.sourceLabel}</Chip><Chip color={j.transparency.score >= 65 ? C.green : C.mustard}>Transparency {j.transparency.score}/100</Chip>{j.visa && <Chip>Visa sponsorship</Chip>}{j.relocation && <Chip>Relocation</Chip>}{j.deadline && <Chip color={C.mustard}>Apply by {j.deadline.slice(0, 10)}</Chip>}{j.interested != null && <Chip>{j.interested} interested</Chip>}</div>
        {j.awaitingCompany && <div style={{ fontSize: 13.5, color: C.text2 }}>Posted by a LinkedOut member and awaiting confirmation from {j.company.name}. {j.verification === "associated" ? "LinkedOut has evidence the poster is connected to the company." : ""}</div>}
        {j.source === "community" && !j.awaitingCompany && <div style={{ fontSize: 13.5, color: C.text2 }}>Community opportunity: not posted by the company. Check the company yourself before sharing personal details.</div>}
        <div className="flex gap-2 flex-wrap mt-1">
          {j.accepting && j.internalApply && !app && (user ? <button className="lo-btn lo-btn-primary" onClick={() => setApplying(true)}>Apply</button> : <Link href="/login" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Log in to apply</Link>)}
          {j.accepting && !j.internalApply && j.externalUrl && <a className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }} href={j.externalUrl} target="_blank" rel="noopener noreferrer nofollow">Apply on the poster's site ↗</a>}
          {j.accepting && !j.internalApply && !j.externalUrl && <span style={{ fontSize: 14, color: C.muted }}>No way to apply was given. Consider reporting this job.</span>}
          {app && <Link href="/jobs/mine" className="lo-btn lo-btn-secondary" style={{ textDecoration: "none" }}>Applied: view status</Link>}
          <button className="lo-btn lo-btn-secondary" onClick={() => act("save")}><Bookmark size={15} fill={j.mine?.saved ? C.mustard : "none"} /> {j.mine?.saved ? "Saved" : "Save"}</button>
          <button className="lo-btn lo-btn-secondary" onClick={() => act("interest")}><Heart size={15} fill={j.mine?.interested ? C.flag : "none"} /> {j.mine?.interested ? "Interested" : "I'm interested"}</button>
          <button className="lo-btn lo-btn-ghost" onClick={() => { navigator.share ? navigator.share({ title: j.title, url: location.href }).catch(() => {}) : navigator.clipboard?.writeText(location.href); setMsg("Link copied."); }}><Share2 size={15} /> Share</button>
          {j.canEdit && <Link href={`/jobs/new?edit=${j.id}`} className="lo-btn lo-btn-ghost" style={{ textDecoration: "none" }}><Pencil size={15} /> Edit</Link>}
        </div>
        {j.mine?.saved && <label style={{ fontSize: 13, color: C.text2 }}><input type="checkbox" onChange={(e) => e.target.checked && act("save", { remind: true })} /> Remind me before applications close</label>}
        {msg && <div style={{ fontSize: 13.5, color: C.text2 }}>{msg}</div>}
      </section>
      {applying && <ApplyPanel job={j} onDone={() => { setApplying(false); load(); setMsg("Application sent. Follow it in My jobs."); }} />}
      <BeforeYouApply jobId={id} />
      {j.description && <section style={box}><h3 style={{ margin: "0 0 8px", fontSize: 16, color: C.text }}>About the role</h3><div style={{ whiteSpace: "pre-wrap", color: C.text2, fontSize: 14.5, lineHeight: 1.65 }}>{j.description}</div></section>}
      <List title="Responsibilities" items={j.responsibilities} /><List title="Requirements" items={j.requirements} /><List title="Preferred" items={j.preferred} /><List title="Benefits" items={j.benefits} />
      {j.skills.length > 0 && <section style={box}><h3 style={{ margin: "0 0 8px", fontSize: 16, color: C.text }}>Skills</h3><div className="flex gap-1.5 flex-wrap">{j.skills.map((s) => <Chip key={s}>{s}</Chip>)}</div></section>}
      {j.hiringProcess.length > 0 && <section style={box}><h3 style={{ margin: "0 0 8px", fontSize: 16, color: C.text }}>Hiring process</h3><div style={{ fontSize: 14.5, color: C.text2 }}>{j.hiringProcess.join("  →  ")}</div></section>}
      <section style={box}><h3 style={{ margin: "0 0 8px", fontSize: 16, color: C.text }}>How transparent is this posting?</h3><div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6 }}>{j.transparencyItems.map((i) => <div key={i.key} style={{ fontSize: 13.5, color: i.ok ? C.text : C.muted }}>{i.ok ? "✓" : "✕"} {i.label}</div>)}</div><div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>A missing item lowers the transparency score, never hides the job.</div></section>
      <div className="flex gap-3 flex-wrap items-center" style={{ fontSize: 13 }}>
        {j.awaitingCompany && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { const r = await act("claim"); if (r) setMsg("Claimed. This is now an official job."); }}>I represent {j.company.name}: claim this job</button>}
        {user && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setRep(rep ? null : { reason: "scam", details: "" })}><Flag size={13} /> Report this job</button>}
      </div>
      {rep && <section style={box} className="flex flex-col gap-2"><select style={inp} value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })}>{Object.entries(REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><textarea rows={2} style={inp} placeholder="What looks wrong? (optional)" value={rep.details} onChange={(e) => setRep({ ...rep, details: e.target.value })} /><div><button className="lo-btn lo-btn-secondary" onClick={async () => { const r = await act("report", rep); if (r) { setRep(null); setMsg("Thank you. A moderator will review it."); } }}>Send report</button></div></section>}
    </div>
  );
}
