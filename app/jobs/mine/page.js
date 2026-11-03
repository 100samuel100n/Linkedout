"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import JobCardV2 from "@/components/jobs/JobCardV2";
import ApplicationChat from "@/components/jobs/ApplicationChat";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };
const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16 };
const FLOW = ["new", "screening", "interview", "final", "offer", "hired"], LABEL = { new: "Applied", screening: "Screening", interview: "Interview", final: "Final decision", offer: "Offer", hired: "Hired" };
const local = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
const Q = { communicated: "Did the company communicate clearly?", expectations: "Were expectations accurate?", salary: "Was salary discussed transparently?", respectful: "Were interviews respectful?", matched: "Did the advertised role match reality?", ghosted: "Did they ghost you?" };

function Application({ a, reload }) {
  const [open, setOpen] = useState(false); const [msgs, setMsgs] = useState(null); const [text, setText] = useState(""); const [sv, setSv] = useState(null); const [err, setErr] = useState(null);
  const loadThread = () => api.jobsMe("thread", { applicationId: a.id }).then((r) => setMsgs(r.messages)).catch((e) => setErr(e.message));
  const idx = FLOW.indexOf(a.stage), closed = ["rejected", "withdrawn"].includes(a.stage);
  const doit = async (b) => { try { await api.jobsMeDo(b); await reload(); if (open) loadThread(); } catch (e) { setErr(e.message); } };
  return (
    <div style={box} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap"><Link href={`/jobs/${a.jobId}`} style={{ fontWeight: 730, color: C.text, fontSize: 16, textDecoration: "none" }}>{a.title}</Link><Link href={`/companies/${a.companyId}`} style={{ color: C.text2, fontSize: 14 }}>{a.company}</Link><span style={{ ...monoFont, fontSize: 11.5, color: C.muted, marginLeft: "auto" }}>Applied {a.applied}</span></div>
      <div className="flex items-center gap-1 flex-wrap">{FLOW.map((s, i) => <span key={s} className="flex items-center gap-1" style={{ fontSize: 13, color: !closed && i <= idx ? C.text : C.muted }}><span style={{ color: !closed && i <= idx ? C.green : C.muted }}>{!closed && i <= idx ? "●" : "○"}</span>{LABEL[s]}{i < FLOW.length - 1 && <span style={{ color: C.line }}>—</span>}</span>)}{closed && <span style={{ ...monoFont, fontSize: 12, color: C.flag }}>{a.stageLabel}</span>}</div>
      {a.interview && <div style={{ background: C.surface2, borderRadius: 12, padding: 10, fontSize: 14, color: C.text }}>
        {a.interview.status === "confirmed" ? <>Interview confirmed: <b>{local(a.interview.chosen)}</b></> : a.interview.status === "reschedule_requested" ? "You asked to reschedule. The company will offer new times." : <>Pick an interview time (shown in your time zone):<div className="flex gap-1.5 flex-wrap mt-1">{a.interview.slots.map((s) => <button key={s} className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => doit({ action: "interview", interviewId: a.interview.id, choice: "choose", slot: s })}>{local(s)}</button>)}<button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => doit({ action: "interview", interviewId: a.interview.id, choice: "reschedule" })}>None work</button></div></>}</div>}
      {a.survey && !sv && <button className="lo-btn lo-btn-secondary lo-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setSv({})}>How was applying here? (anonymous, 2 minutes)</button>}
      {sv && <div className="flex flex-col gap-2" style={{ background: C.surface2, borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: 13, color: C.muted }}>Your answers are anonymous and only shown to the company as totals once 5 people have answered.</div>
        {Object.entries(Q).map(([k, q]) => <div key={k} className="flex items-center gap-2 flex-wrap" style={{ fontSize: 14, color: C.text }}><span style={{ flex: "1 1 240px" }}>{q}</span>{[["yes", true], ["no", false]].map(([l, v]) => <button key={l} onClick={() => setSv({ ...sv, [k]: v })} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: sv[k] === v ? C.mustard : "transparent", color: sv[k] === v ? "#fff" : C.text2 }}>{l}</button>)}</div>)}
        <select style={inp} value={sv.speed || ""} onChange={(e) => setSv({ ...sv, speed: e.target.value })}><option value="">How long did they take to reply?</option>{["Under a week", "1-2 weeks", "2-4 weeks", "Over 4 weeks", "Never did"].map((o) => <option key={o}>{o}</option>)}</select>
        <div><button className="lo-btn lo-btn-primary lo-btn-sm" onClick={async () => { await doit({ action: "survey", applicationId: a.id, answers: sv }); setSv(null); }}>Submit anonymously</button></div></div>}
      <div className="flex gap-2 flex-wrap"><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setOpen(!open)}>Messages{a.unread ? ` (${a.unread} new)` : ""}</button>{!closed && a.stage !== "hired" && <button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={() => confirm("Withdraw this application?") && doit({ action: "withdraw", applicationId: a.id })}>Withdraw</button>}</div>
      {open && <ApplicationChat side="candidate" icsHref={(iid) => `/api/jobs/me/ics?interviewId=${iid}`} counterpart={a.company} subtitle={`${a.title} · ${a.stageLabel}`} load={(since) => api.jobsMe("thread", { applicationId: a.id, ...(since ? { since } : {}) }).then((r) => r.messages)} send={async ({ text, links }) => { await api.jobsMeDo({ action: "message", applicationId: a.id, body: text, links }); reload(); }} onInterview={(interviewId, choice, slot) => doit({ action: "interview", interviewId, choice, slot })} />}
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}

function Mine() {
  const { user, loading } = useAuth(); const router = useRouter(); const sp = useSearchParams(); const tab = sp.get("tab") || "applications";
  const [d, setD] = useState(null); const [err, setErr] = useState(null); const [prefs, setPrefs] = useState({ titles: "", skills: "", locations: "", modes: [], salaryMin: "", seniority: "" }); const [msg, setMsg] = useState(null);
  const load = useCallback(async () => { try { setErr(null); if (tab === "prefs") { const p = await api.jobsMe("prefs"); setPrefs({ titles: (p.titles || []).join("\n"), skills: (p.skills || []).join("\n"), locations: (p.locations || []).join("\n"), modes: p.modes || [], salaryMin: p.salaryMin || "", seniority: p.seniority || "" }); setD({}); } else setD(await api.jobsMe(tab)); } catch (e) { setErr(e.message); } }, [tab]);
  useEffect(() => { if (!loading && !user) router.push("/login"); else if (user) { setD(null); load(); } }, [user, loading, load, router]);
  const go = (t) => router.replace(`/jobs/mine?tab=${t}`, { scroll: false });
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div className="flex items-center gap-2"><h1 style={{ margin: 0, fontSize: 26, fontWeight: 780, color: C.text }}>My jobs</h1><Link href="/jobs" className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto", textDecoration: "none" }}>Find jobs</Link></div>
      <nav className="flex gap-1.5 flex-wrap">{[["applications", "Applications"], ["saved", "Saved"], ["alerts", "Job alerts"], ["prefs", "Preferences"]].map(([k, l]) => <button key={k} onClick={() => go(k)} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${tab === k ? C.mustard : C.line}`, background: tab === k ? C.mustard : "transparent", color: tab === k ? "#fff" : C.text2 }}>{l}</button>)}</nav>
      {err && <ErrorNote>{err}</ErrorNote>}
      {!d && !err ? <Loading variant="cards" /> : <>
        {tab === "applications" && d && (d.applications?.length ? d.applications.map((a) => <Application key={a.id} a={a} reload={load} />) : <div style={{ color: C.text2 }}>No applications yet. <Link href="/jobs" style={{ color: C.corpblue }}>Find a job</Link>.</div>)}
        {tab === "saved" && d && (d.jobs?.length ? d.jobs.map((j) => <JobCardV2 key={j.id} job={j} onSave={async (x) => { await api.jobDo(x.id, { action: "save" }); load(); }} />) : <div style={{ color: C.text2 }}>Nothing saved. Tap the bookmark on any job.</div>)}
        {tab === "alerts" && d && <div className="flex flex-col gap-2">{d.alerts?.length ? d.alerts.map((a) => <div key={a.id} style={box} className="flex items-center gap-2 flex-wrap"><b style={{ color: C.text }}>{a.label}</b><span style={{ fontSize: 13, color: C.muted }}>{a.active ? "on" : "paused"}</span><span style={{ marginLeft: "auto" }} className="flex gap-1"><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { await api.jobsMeDo({ action: "alert.toggle", id: a.id, on: !a.active }); load(); }}>{a.active ? "Pause" : "Resume"}</button><button className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }} onClick={async () => { await api.jobsMeDo({ action: "alert.delete", id: a.id }); load(); }}>Delete</button></span></div>) : <div style={{ color: C.text2 }}>No alerts. Search for jobs, then tap “Alert me about jobs like this”.</div>}</div>}
        {tab === "prefs" && <div style={box} className="flex flex-col gap-2">
          <div style={{ fontSize: 14, color: C.text2 }}>Tell us what you're looking for. Match scores come only from this and the jobs you save or apply to, and the reasons are always shown.</div>
          {[["titles", "Roles you look for"], ["skills", "Your skills"], ["locations", "Locations"]].map(([k, l]) => <div key={k}><div style={{ fontSize: 13, fontWeight: 650, color: C.text }}>{l} <span style={{ fontWeight: 400, color: C.muted }}>(one per line)</span></div><textarea rows={3} style={inp} value={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.value })} /></div>)}
          <div className="flex gap-1.5 flex-wrap">{["remote", "hybrid", "onsite"].map((m) => <button key={m} onClick={() => setPrefs({ ...prefs, modes: prefs.modes.includes(m) ? prefs.modes.filter((x) => x !== m) : [...prefs.modes, m] })} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${C.line}`, background: prefs.modes.includes(m) ? C.mustard : "transparent", color: prefs.modes.includes(m) ? "#fff" : C.text2 }}>{m}</button>)}</div>
          <div className="flex gap-2"><input style={inp} type="number" placeholder="Minimum salary" value={prefs.salaryMin} onChange={(e) => setPrefs({ ...prefs, salaryMin: e.target.value })} /><select style={inp} value={prefs.seniority} onChange={(e) => setPrefs({ ...prefs, seniority: e.target.value })}><option value="">Any level</option>{["intern", "entry", "mid", "senior", "lead", "executive"].map((s) => <option key={s}>{s}</option>)}</select></div>
          <div><button className="lo-btn lo-btn-primary" onClick={async () => { try { await api.jobsMeDo({ action: "prefs.save", ...prefs }); setMsg("Saved."); } catch (e) { setMsg(e.message); } }}>Save preferences</button> {msg && <span style={{ fontSize: 13.5, color: C.text2 }}>{msg}</span>}</div></div>}
      </>}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading variant="cards" />}><Mine /></Suspense>; }
