"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import JobForm from "@/components/jobs/JobForm";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14, width: "100%" };
const Choice = ({ title, text, onClick }) => <button onClick={onClick} className="lo-card text-left" style={{ padding: 16, cursor: "pointer" }}><div style={{ fontWeight: 730, color: C.text }}>{title}</div><div style={{ fontSize: 13.5, color: C.text2, marginTop: 4 }}>{text}</div></button>;
function New() {
  const { user, loading } = useAuth(); const router = useRouter(); const sp = useSearchParams(); const edit = sp.get("edit");
  const [step, setStep] = useState(edit ? "form" : "who"); const [mine, setMine] = useState([]); const [all, setAll] = useState([]); const [q, setQ] = useState(""); const [target, setTarget] = useState(null); const [initial, setInitial] = useState(null); const [name, setName] = useState("");
  useEffect(() => { if (!user) return; api.getMyCompanies().then((r) => setMine((r.companies || r).filter?.((c) => c.verification === "verified") || [])).catch(() => {}); api.getCompanies().then((r) => setAll(r.companies || r)).catch(() => {}); }, [user]);
  useEffect(() => { if (!edit) return; api.job(edit).then((j) => { setInitial({ title: j.title, department: j.department, seniority: j.seniority, employmentType: j.type, workplaceMode: j.mode, officeDays: j.officeDays, locations: j.locations, salaryMin: j.salaryMin, salaryMax: j.salaryMax, currency: j.currency, salaryPeriod: j.salaryPeriod, deadline: j.deadline, description: j.description, responsibilities: j.responsibilities, requirements: j.requirements, preferred: j.preferred, benefits: j.benefits, skills: j.skills, hiringProcess: j.hiringProcess, screeningQuestions: j.screeningQuestions, externalUrl: j.externalUrl, roleContext: j.roleContext, visa: j.visa, relocation: j.relocation, applicationMethod: j.internalApply ? "internal" : "external" }); setTarget({ forWhom: j.source === "official" ? "my_company" : j.company.id ? "other_company" : "community", id: j.company.id, name: j.company.name }); }); }, [edit]);
  if (loading) return <Loading variant="cards" />;
  if (!user) return <div style={{ color: C.text }}>Please <Link href="/login" style={{ color: C.corpblue }}>log in</Link> to post a job.</div>;
  const done = (r) => router.push(r.id ? `/jobs/${r.id}` : `/jobs/${edit}`);
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 780, color: C.text }}>{edit ? "Edit job" : "Post a job"}</h1>
      {step === "who" && <><div style={{ color: C.text2 }}>Who are you posting for?</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <Choice title="My company" text="Official posting by an authorised representative. Needs a verified company page you manage." onClick={() => setStep("mine")} />
          <Choice title="Another company" text="Link it to the real company. It's marked as community-posted until the company confirms it." onClick={() => setStep("other")} />
          <Choice title="Community opportunity" text="You found it, or it isn't tied to a company here. Clearly labelled, and people apply on your link." onClick={() => setStep("community")} />
        </div></>}
      {step === "mine" && <div className="flex flex-col gap-2">{mine.length ? mine.map((c) => <Choice key={c.id} title={c.name} text="Post as an official company job" onClick={() => { setTarget({ forWhom: "my_company", id: c.id, name: c.name }); setStep("form"); }} />) : <div style={{ color: C.text2 }}>You don't manage a verified company page yet. <Link href="/companies" style={{ color: C.corpblue }}>Find or verify your company</Link>.</div>}</div>}
      {step === "other" && <div className="flex flex-col gap-2"><input style={inp} placeholder="Search for the company…" value={q} onChange={(e) => setQ(e.target.value)} />{all.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8).map((c) => <Choice key={c.id} title={c.name} text={c.industry || ""} onClick={() => { setTarget({ forWhom: "other_company", id: c.id, name: c.name }); setStep("form"); }} />)}<div style={{ fontSize: 13, color: C.muted }}>Not listed? Post it as a community opportunity.</div></div>}
      {step === "community" && <div className="flex flex-col gap-2"><input style={inp} placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} /><div><button className="lo-btn lo-btn-primary" disabled={name.trim().length < 2} onClick={() => { setTarget({ forWhom: "community", name }); setStep("form"); }}>Continue</button></div></div>}
      {step === "form" && target && (!edit || initial) && <>
        <div style={{ fontSize: 14, color: C.text2 }}>{target.forWhom === "my_company" ? `Official job for ${target.name}` : target.forWhom === "other_company" ? `Community-posted job for ${target.name}, awaiting the company's confirmation` : `Community opportunity: ${target.name}`}</div>
        <JobForm initial={initial || {}} forWhom={target.forWhom} companyId={target.id} companyName={target.name} editId={edit} onSaved={done} /></>}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading variant="cards" />}><New /></Suspense>; }
