"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Bell, Plus, Briefcase } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import JobCardV2 from "@/components/jobs/JobCardV2";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };
const MODES = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]], TYPES = [["full_time", "Full-time"], ["part_time", "Part-time"], ["contract", "Contract"], ["internship", "Internship"]], LEVELS = [["entry", "Entry"], ["mid", "Mid"], ["senior", "Senior"], ["lead", "Lead"]];
const Toggle = ({ on, onClick, children }) => <button onClick={onClick} className="lo-btn lo-btn-sm" style={{ border: `1px solid ${on ? C.mustard : C.line}`, background: on ? C.mustard : "transparent", color: on ? "#fff" : C.text2 }}>{children}</button>;
const flip = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function Jobs() {
  const { user } = useAuth(); const router = useRouter(); const sp = useSearchParams();
  const [f, setF] = useState({ q: sp.get("q") || "", location: sp.get("location") || "", mode: sp.get("mode")?.split(",").filter(Boolean) || [], type: sp.get("type")?.split(",").filter(Boolean) || [], seniority: [], salaryMin: "", transparency: "", verified: false, postedWithin: "", visa: false, relocation: false, sort: "relevance" });
  const [home, setHome] = useState(null); const [res, setRes] = useState(null); const [err, setErr] = useState(null); const [page, setPage] = useState(1); const [msg, setMsg] = useState(null);
  const searching = !!(f.q || f.location || f.mode.length || f.type.length || f.seniority.length || f.salaryMin || f.transparency || f.verified || f.postedWithin || f.visa || f.relocation);
  const qs = useCallback(() => { const p = new URLSearchParams(); if (f.q) p.set("q", f.q); if (f.location) p.set("location", f.location); if (f.mode.length) p.set("mode", f.mode.join(",")); if (f.type.length) p.set("type", f.type.join(",")); if (f.seniority.length) p.set("seniority", f.seniority.join(",")); if (f.salaryMin) p.set("salaryMin", f.salaryMin); if (f.transparency) p.set("transparency", f.transparency); if (f.verified) p.set("verified", "1"); if (f.postedWithin) p.set("postedWithin", f.postedWithin); if (f.visa) p.set("visa", "1"); if (f.relocation) p.set("relocation", "1"); p.set("sort", f.sort); p.set("page", String(page)); return p.toString(); }, [f, page]);
  useEffect(() => { api.jobsHome().then(setHome).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (!searching) { setRes(null); return; } const t = setTimeout(() => api.jobsSearch(qs()).then(setRes).catch((e) => setErr(e.message)), 250); return () => clearTimeout(t); }, [qs, searching]);
  async function save(j) { if (!user) return router.push("/login"); try { const r = await api.jobDo(j.id, { action: "save" }); const upd = (l) => l.map((x) => (x.id === j.id ? { ...x, saved: r.saved } : x)); setRes((x) => x && { ...x, jobs: upd(x.jobs) }); setHome((h) => h && { ...h, newest: upd(h.newest), recommended: { ...h.recommended, jobs: upd(h.recommended.jobs) } }); } catch (e) { setMsg(e.message); } }
  async function alertMe() { if (!user) return router.push("/login"); try { await api.jobsMeDo({ action: "alert.create", query: { q: f.q, location: f.location, modes: f.mode, types: f.type, salaryMin: f.salaryMin, verifiedOnly: f.verified, transparency: f.transparency || undefined } }); setMsg("Alert created. We'll notify you when a matching job is posted."); } catch (e) { setMsg(e.message); } }
  const List = ({ jobs }) => <div className="flex flex-col gap-3">{jobs.map((j) => <JobCardV2 key={j.id} job={j} onSave={save} />)}</div>;
  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div style={{ background: alpha(C.mustard, 8), border: `1px solid ${alpha(C.mustard, 30)}`, borderRadius: 20, padding: 22 }} className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap"><h1 style={{ margin: 0, fontSize: 30, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>Jobs</h1><span style={{ marginLeft: "auto" }} className="flex gap-2">{user && <Link href="/jobs/mine" className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }}><Briefcase size={14} /> My jobs</Link>}<Link href="/jobs/new" className="lo-btn lo-btn-primary lo-btn-sm" style={{ textDecoration: "none" }}><Plus size={14} /> Post a job</Link></span></div>
        <div style={{ fontSize: 16, color: C.text2 }}>Find work. Know what you're getting into.</div>
        <div className="flex gap-2 flex-wrap"><div style={{ position: "relative", flex: "2 1 240px" }}><Search size={16} color={C.muted} style={{ position: "absolute", left: 12, top: 12 }} /><input style={{ ...inp, paddingLeft: 36 }} placeholder="Job title, skill or company" value={f.q} onChange={(e) => { setPage(1); setF({ ...f, q: e.target.value }); }} /></div><input style={{ ...inp, flex: "1 1 160px" }} placeholder="Location" value={f.location} onChange={(e) => { setPage(1); setF({ ...f, location: e.target.value }); }} /></div>
        <div className="flex gap-1.5 flex-wrap items-center">{MODES.map(([k, l]) => <Toggle key={k} on={f.mode.includes(k)} onClick={() => setF({ ...f, mode: flip(f.mode, k) })}>{l}</Toggle>)}{TYPES.map(([k, l]) => <Toggle key={k} on={f.type.includes(k)} onClick={() => setF({ ...f, type: flip(f.type, k) })}>{l}</Toggle>)}{LEVELS.map(([k, l]) => <Toggle key={k} on={f.seniority.includes(k)} onClick={() => setF({ ...f, seniority: flip(f.seniority, k) })}>{l}</Toggle>)}</div>
        <div className="flex gap-2 flex-wrap items-center">
          <input style={{ ...inp, width: 150 }} type="number" placeholder="Minimum salary" value={f.salaryMin} onChange={(e) => setF({ ...f, salaryMin: e.target.value })} />
          <select style={{ ...inp, width: "auto" }} value={f.transparency} onChange={(e) => setF({ ...f, transparency: e.target.value })}><option value="">Any transparency</option><option value="good">Good or better</option><option value="excellent">Excellent</option></select>
          <select style={{ ...inp, width: "auto" }} value={f.postedWithin} onChange={(e) => setF({ ...f, postedWithin: e.target.value })}><option value="">Any date</option><option value="1">Last 24 hours</option><option value="7">Last week</option><option value="30">Last month</option></select>
          <Toggle on={f.verified} onClick={() => setF({ ...f, verified: !f.verified })}>Verified companies only</Toggle><Toggle on={f.visa} onClick={() => setF({ ...f, visa: !f.visa })}>Visa sponsorship</Toggle><Toggle on={f.relocation} onClick={() => setF({ ...f, relocation: !f.relocation })}>Relocation</Toggle>
          <select style={{ ...inp, width: "auto", marginLeft: "auto" }} value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })}><option value="relevance">Best first</option><option value="newest">Newest</option><option value="transparency">Most transparent</option>{user && <option value="match">Best match</option>}</select>
        </div>
        {searching && <div><button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={alertMe}><Bell size={13} /> Alert me about jobs like this</button></div>}
        {msg && <div style={{ fontSize: 13.5, color: C.text2 }}>{msg}</div>}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {searching ? (res ? (<><div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{res.total} job{res.total === 1 ? "" : "s"}. Ranked by transparency, freshness and verification. Nobody can pay to rank higher.</div>{res.promoted?.length > 0 && <div className="flex flex-col gap-2"><div style={{ ...monoFont, fontSize: 11, color: C.muted }}>PROMOTED: companies pay to show these here. They are not ranked higher than anything else below.</div><List jobs={res.promoted} /></div>}{res.jobs.length ? <List jobs={res.jobs} /> : <div style={{ color: C.text2 }}>No jobs match. Try fewer filters, or set an alert.</div>}
        {res.pages > 1 && <div className="flex gap-2 items-center"><button className="lo-btn lo-btn-ghost lo-btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span style={monoFont}>{page} / {res.pages}</span><button className="lo-btn lo-btn-ghost lo-btn-sm" disabled={page >= res.pages} onClick={() => setPage(page + 1)}>Next</button></div>}</>) : <Loading variant="cards" />)
        : !home ? <Loading variant="cards" /> : (<>
          <section className="flex flex-col gap-3"><h2 style={{ margin: 0, fontSize: 18, color: C.text }}>{home.recommended.personalised ? "Recommended for you" : "Most transparent right now"}</h2>{!home.recommended.personalised && user && <div style={{ fontSize: 13.5, color: C.text2 }}>Tell us your skills and preferences in <Link href="/jobs/mine?tab=prefs" style={{ color: C.corpblue }}>My jobs</Link> to get match scores with reasons.</div>}{home.recommended.jobs.length ? <List jobs={home.recommended.jobs} /> : <div style={{ color: C.text2 }}>No open jobs yet. Be the first to post one.</div>}</section>
          {home.newest.length > 0 && <section className="flex flex-col gap-3"><h2 style={{ margin: 0, fontSize: 18, color: C.text }}>Newly posted</h2><List jobs={home.newest} /></section>}
          <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }} className="flex flex-col gap-2"><h2 style={{ margin: 0, fontSize: 18, color: C.text }}>Before you apply</h2><div style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.55 }}>Every job shows what people report about the company behind it, the real hiring experience, and how transparent the posting is. Jobs, companies and stories are one system.</div><div><Link href="/companies" className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }}>Explore workplace intelligence</Link></div></section>
        </>)}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading variant="cards" />}><Jobs /></Suspense>; }
