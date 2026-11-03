"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Chip } from "./JobCardV2";

const LVL = { "High concern": C.flag, "Some concern": C.mustard, "Low concern": C.green };
const box = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 };
// "Before you apply": what people report about the company behind this job, as aggregates with sample sizes, never a verdict.
export default function BeforeYouApply({ jobId }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.jobIntel(jobId).then(setD).catch(() => setD({ available: false, note: "Couldn't load this right now." })); }, [jobId]);
  if (!d) return <Loading variant="cards" />;
  if (!d.available) return <section style={box}><h2 style={{ margin: 0, fontSize: 18, color: C.text }}>Before you apply</h2><p style={{ color: C.text2, fontSize: 14.5, lineHeight: 1.55 }}>{d.note}</p></section>;
  const w = d.workplace, r = d.role;
  return (
    <section style={box} className="flex flex-col gap-3" aria-label="Before you apply">
      <div className="flex items-center gap-2 flex-wrap"><ShieldCheck size={18} color={C.corpblue} /><h2 style={{ margin: 0, fontSize: 18, color: C.text }}>Before you apply</h2><Chip color={C.corpblue}>What people report, not a verdict</Chip></div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[["Company reputation", d.reputation || "Not enough data"], ["Job transparency", `${d.transparency}/100`], ["Company response", d.response ? `${d.response.label}${d.response.rate != null ? ` · ${d.response.rate}%` : ""}` : "Not enough data"], ["Recent stories (90 days)", d.signals.stories90], ["Hiring experience", d.hiring.vsIndustry || (d.hiring.reports ? `${d.hiring.reports} reports` : "Not enough data")]].map(([k, v]) =>
          <div key={k} style={{ background: C.surface2, borderRadius: 12, padding: 12 }}><div className="lo-eyebrow">{k}</div><div style={{ fontSize: 17, fontWeight: 740, color: C.text }}>{v}</div></div>)}
      </div>
      {w.positive != null ? <div>
        <div style={{ fontSize: 14, color: C.text }}>Recent employee reports: <b>{w.positive}% positive · {w.mixed}% mixed · {w.negative}% negative</b></div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{w.note}</div></div> : <div style={{ fontSize: 14, color: C.text2 }}>{w.note}</div>}
      {d.signals.layoffs + d.signals.salary + d.signals.ghosting > 0 && <div style={{ fontSize: 14, color: C.text }}>Recent workplace signals: {[d.signals.layoffs && `${d.signals.layoffs} layoff ${d.signals.layoffs === 1 ? "story" : "stories"}`, d.signals.salary && `${d.signals.salary} salary-discrepancy ${d.signals.salary === 1 ? "report" : "reports"}`, d.signals.ghosting && `${d.signals.ghosting} hiring-ghosting ${d.signals.ghosting === 1 ? "report" : "reports"}`].filter(Boolean).join(", ")} in the last 90 days.</div>}
      {r.dimensions.some((x) => x.level) && <div>
        <div className="lo-eyebrow">What people report about {r.scope === "role" ? "this role" : "working here"} <span style={{ textTransform: "none" }}>({r.note})</span></div>
        <div className="flex gap-1.5 flex-wrap mt-1.5">{r.dimensions.filter((x) => x.level).map((x) => <span key={x.key} title={`${x.concern}% of ${x.n} reports raised concerns`}><Chip color={LVL[x.level]}>{x.label}: {x.level}</Chip></span>)}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Based on the share of reports raising concerns about each area. One person's experience is never treated as a fact about the company.</div></div>}
      {d.claim && <div style={{ background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: 12, fontSize: 14, color: C.text }}>
        <div className="lo-eyebrow">Company says vs people report</div><div><b>Company says:</b> {d.claim.says}</div><div><b>People report:</b> {d.claim.reports}</div><div style={{ color: C.muted, fontSize: 12.5 }}>{d.claim.note}</div></div>}
      {d.companyContext && <div style={{ background: C.surface2, borderRadius: 12, padding: 12, fontSize: 14, color: C.text }}><div className="lo-eyebrow">Company context <span style={{ textTransform: "none" }}>(written by the company)</span></div>{d.companyContext}</div>}
      {d.hiring.survey?.ready && <div style={{ fontSize: 14, color: C.text }}>Candidates say: {[d.hiring.survey.communicated != null && `${d.hiring.survey.communicated}% felt the company communicated clearly`, d.hiring.survey.ghosted != null && `${d.hiring.survey.ghosted}% were ghosted`, d.hiring.survey.matched != null && `${d.hiring.survey.matched}% said the role matched the advert`].filter(Boolean).join(" · ")} <span style={{ color: C.muted }}>({d.hiring.survey.responses} answers)</span></div>}
      <Link href={d.companyLink} className="lo-btn lo-btn-secondary" style={{ textDecoration: "none", alignSelf: "flex-start" }}>See what people are saying about {d.company.name} →</Link>
    </section>
  );
}
