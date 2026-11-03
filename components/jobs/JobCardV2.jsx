"use client";
import Link from "next/link";
import { BadgeCheck, Bookmark, MapPin, Clock } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";

const VER = { verified: [C.green, "Verified"], associated: [C.corpblue, "Company-associated"], community: [C.muted, "Community"], external: [C.muted, "External"], review: [C.flag, "Under review"] };
const MODE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" }, TYPE = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship", temporary: "Temporary", freelance: "Freelance" };
const TCOL = (s) => (s >= 85 ? C.green : s >= 65 ? C.corpblue : s >= 40 ? C.mustard : C.muted);
export const Chip = ({ children, color = C.muted }) => <span style={{ ...monoFont, fontSize: 11, color, border: `1px solid ${alpha(color, 45)}`, background: alpha(color, 10), borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>{children}</span>;

// An intelligent job card: who really posted it, how transparent it is, what people report about the company.
export default function JobCardV2({ job: j, onSave }) {
  const [vc, vl] = VER[j.verification] || VER.community;
  return (
    <div className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Link href={`/jobs/${j.id}`} style={{ fontSize: 17, fontWeight: 730, color: C.text, textDecoration: "none" }}>{j.title}</Link>
          <div style={{ fontSize: 14, color: C.text2, marginTop: 2 }}>{j.company.id ? <Link href={`/companies/${j.company.id}`} style={{ color: C.text2 }}>{j.company.name}</Link> : j.company.name} {j.company.verified && <BadgeCheck size={14} color={C.green} style={{ display: "inline", verticalAlign: "-2px" }} aria-label="Verified company" />}</div>
        </div>
        {j.match != null && <div style={{ textAlign: "right" }}><div style={{ fontSize: 20, fontWeight: 780, color: C.green }}>{j.match}%</div><div style={{ ...monoFont, fontSize: 10, color: C.muted }}>match</div></div>}
        {onSave && <button onClick={() => onSave(j)} className="lo-btn lo-btn-ghost lo-btn-sm" aria-label={j.saved ? "Unsave job" : "Save job"}><Bookmark size={16} fill={j.saved ? C.mustard : "none"} color={j.saved ? C.mustard : C.muted} /></button>}
      </div>
      <div className="flex gap-x-3 gap-y-1 flex-wrap items-center" style={{ fontSize: 13, color: C.text2 }}>
        {(j.locations?.length > 0 || j.mode) && <span className="inline-flex items-center gap-1"><MapPin size={13} />{[j.locations?.[0], MODE[j.mode]].filter(Boolean).join(" · ")}</span>}
        {j.type && <span>{TYPE[j.type]}</span>}
        <span className="inline-flex items-center gap-1"><Clock size={13} />{j.posted}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{j.salary || <span style={{ fontWeight: 400, color: C.muted }}>Salary not disclosed</span>}</div>
      <div className="flex gap-1.5 flex-wrap">
        <Chip color={vc}>{vl}</Chip>
        <Chip color={TCOL(j.transparency.score)}>Transparency: {j.transparency.level} ({j.transparency.score})</Chip>
        {j.reputation?.health && <Chip color={C.corpblue}>Company reports: {j.reputation.health}</Chip>}
        {j.reputation?.response && <Chip color={C.muted}>{j.reputation.response}</Chip>}
        {j.promoted && <Chip color={C.mustard}>Promoted</Chip>}
        {j.source === "community" && <Chip>Community opportunity</Chip>}
        {j.awaitingCompany && <Chip color={C.mustard}>Awaiting company confirmation</Chip>}
      </div>
      {j.matchReasons?.length > 0 && <div style={{ fontSize: 12.5, color: C.muted }}>{j.matchReasons.join(" · ")}</div>}
    </div>
  );
}
