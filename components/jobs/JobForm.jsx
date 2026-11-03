"use client";
import { useMemo, useState } from "react";
import { C } from "@/lib/theme";
import { api } from "@/lib/api";
import ErrorNote from "@/components/ErrorNote";
import { transparency, WORK_MODES, EMPLOYMENT_TYPES, SENIORITY, PERIODS } from "@/lib/jobs/logic";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };
const lab = (t, hint) => <div style={{ fontSize: 13, fontWeight: 650, color: C.text, marginBottom: 3 }}>{t}{hint && <span style={{ fontWeight: 400, color: C.muted }}> {hint}</span>}</div>;
const L = (a) => (Array.isArray(a) ? a.join("\n") : a || "");
// One form for every kind of posting. The meter on the right is the same transparency score the job page shows.
export default function JobForm({ initial = {}, forWhom, companyId, companyName, editId, onSaved, viaCompany = false }) {
  const [f, setF] = useState({ title: "", department: "", seniority: "", employmentType: "full_time", workplaceMode: "hybrid", officeDays: "", locations: "", salaryMin: "", salaryMax: "", currency: "KES", salaryPeriod: "month", bonusEquity: "", description: "", responsibilities: "", requirements: "", preferred: "", benefits: "", skills: "", hiringProcess: "", screeningQuestions: "", applicationMethod: forWhom === "my_company" ? "internal" : "external", externalUrl: "", deadline: "", visa: false, relocation: false, roleContext: "", ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, Array.isArray(v) ? L(v) : v ?? ""])) });
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF({ ...f, [k]: v });
  const lines = (s) => String(s).split("\n").map((x) => x.trim()).filter(Boolean);
  const t = useMemo(() => transparency({ salary_min: f.salaryMin || null, salary_max: f.salaryMax || null, currency: f.currency, salary_period: f.salaryPeriod, locations: lines(f.locations), workplace_mode: f.workplaceMode, employment_type: f.employmentType, responsibilities: lines(f.responsibilities), requirements: lines(f.requirements), benefits: lines(f.benefits), hiring_process: lines(f.hiringProcess), deadline: f.deadline, description: f.description, skills: lines(f.skills) }), [f]);
  async function submit(publish) {
    setBusy(true); setErr(null);
    try {
      const body = { ...f, forWhom, companyId, companyName, publish, deadline: f.deadline ? new Date(f.deadline).toISOString() : "" };
      const r = viaCompany ? await api.suiteDo(companyId, { action: editId ? "job.update" : "job.create", jobId: editId, ...body }) : editId ? await api.jobUpdate(editId, body) : await api.jobCreate(body);
      onSaved(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const official = forWhom === "my_company";
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
      <div className="flex flex-col gap-3" style={{ gridColumn: "span 2" }}>
        <div>{lab("Job title")}<input style={inp} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Software Engineer" /></div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div>{lab("Department")}<input style={inp} value={f.department} onChange={(e) => set("department", e.target.value)} /></div>
          <div>{lab("Level")}<select style={inp} value={f.seniority} onChange={(e) => set("seniority", e.target.value)}><option value="">Not specified</option>{SENIORITY.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div>{lab("Type")}<select style={inp} value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)}>{EMPLOYMENT_TYPES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></div>
          <div>{lab("Work arrangement")}<select style={inp} value={f.workplaceMode} onChange={(e) => set("workplaceMode", e.target.value)}>{WORK_MODES.map((s) => <option key={s}>{s}</option>)}</select></div>
          {f.workplaceMode === "hybrid" && <div>{lab("Office days / week")}<input style={inp} type="number" min="0" max="5" value={f.officeDays} onChange={(e) => set("officeDays", e.target.value)} /></div>}
        </div>
        <div>{lab("Locations", "(one per line)")}<textarea rows={2} style={inp} value={f.locations} onChange={(e) => set("locations", e.target.value)} placeholder="Nairobi" /></div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}>
          <div>{lab("Salary min")}<input style={inp} type="number" value={f.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} /></div><div>{lab("Salary max")}<input style={inp} type="number" value={f.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} /></div>
          <div>{lab("Currency")}<input style={inp} value={f.currency} onChange={(e) => set("currency", e.target.value)} /></div><div>{lab("Per")}<select style={inp} value={f.salaryPeriod} onChange={(e) => set("salaryPeriod", e.target.value)}>{PERIODS.map((p) => <option key={p}>{p}</option>)}</select></div>
        </div>
        <div>{lab("Bonus / equity", "(optional)")}<input style={inp} value={f.bonusEquity} onChange={(e) => set("bonusEquity", e.target.value)} /></div>
        <div>{lab("About the role")}<textarea rows={6} style={inp} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What will this person do, with whom, and why does it matter?" /></div>
        {[["responsibilities", "Responsibilities"], ["requirements", "Requirements"], ["preferred", "Preferred qualifications"], ["benefits", "Benefits"], ["skills", "Skills"], ["hiringProcess", "Hiring process steps"]].map(([k, l]) => <div key={k}>{lab(l, "(one per line)")}<textarea rows={3} style={inp} value={f[k]} onChange={(e) => set(k, e.target.value)} /></div>)}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div>{lab("Application deadline")}<input type="datetime-local" style={inp} value={f.deadline?.slice(0, 16)} onChange={(e) => set("deadline", e.target.value)} /></div>
          <div className="flex gap-4 items-end" style={{ fontSize: 14, color: C.text }}><label><input type="checkbox" checked={!!f.visa} onChange={(e) => set("visa", e.target.checked)} /> Visa sponsorship</label><label><input type="checkbox" checked={!!f.relocation} onChange={(e) => set("relocation", e.target.checked)} /> Relocation</label></div>
        </div>
        {official && <>
          <div>{lab("How people apply")}<select style={inp} value={f.applicationMethod} onChange={(e) => set("applicationMethod", e.target.value)}><option value="internal">Inside LinkedOut (you get a hiring pipeline)</option><option value="external">On your own careers site</option></select></div>
          {f.applicationMethod === "internal" && <div>{lab("Screening questions", "(one per line, up to 5)")}<textarea rows={3} style={inp} value={f.screeningQuestions} onChange={(e) => set("screeningQuestions", e.target.value)} /></div>}
          <div>{lab("Company context", "(optional, shown on the job as written by the company, e.g. what's changed since earlier reports)")}<textarea rows={2} style={inp} value={f.roleContext} onChange={(e) => set("roleContext", e.target.value)} /></div></>}
        {(f.applicationMethod === "external" || !official) && <div>{lab("Application link", "(https://…)")}<input style={inp} value={f.externalUrl} onChange={(e) => set("externalUrl", e.target.value)} /></div>}
      </div>
      <aside className="flex flex-col gap-2" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, alignSelf: "start" }}>
        <div className="lo-eyebrow">Job transparency</div><div style={{ fontSize: 30, fontWeight: 800, color: t.score >= 65 ? C.green : C.mustard }}>{t.score}<span style={{ fontSize: 14, color: C.muted }}> / 100 · {t.level}</span></div>
        {t.items.map((i) => <div key={i.key} style={{ fontSize: 13, color: i.ok ? C.text : C.muted }}>{i.ok ? "✓" : "✕"} {i.label}</div>)}
        <div style={{ fontSize: 12, color: C.muted }}>Higher transparency ranks higher in search. Leaving things out never hides your job.</div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <button className="lo-btn lo-btn-primary" disabled={busy || f.title.trim().length < 3} onClick={() => submit(true)}>{editId ? "Save changes" : "Publish job"}</button>
        {!editId && <button className="lo-btn lo-btn-secondary" disabled={busy || f.title.trim().length < 3} onClick={() => submit(false)}>Save as draft</button>}
      </aside>
    </div>
  );
}
