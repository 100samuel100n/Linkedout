"use client";
import { C, monoFont, displayFont, sunken } from "@/lib/theme";
import { Stamp } from "@/components/primitives";

export default function JobCard({ job }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div style={{ ...displayFont, fontSize: 15, color: C.text }}>{job.title}</div>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>{job.company}</div>
        </div>
        {job.ghosted && <Stamp text="Ghosts Applicants" tone="flag" rotate={-6} />}
      </div>
      <div style={{ ...monoFont, fontSize: 13, color: job.salary.startsWith("$0") ? C.flag : C.mustard }}>{job.salary}</div>
      <div style={{ background: sunken, borderRadius: 8, padding: 10, border: `1px solid ${C.line}` }}>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Brutal Honesty — why did the last person quit?</div>
        <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>{job.lastPersonQuit}</div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          Honesty score
          <div style={{ width: 70, height: 6, background: C.surface2, borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${job.honesty}%`, height: "100%", background: job.honesty > 50 ? C.green : C.flag }} />
          </div>
          {job.honesty}%
        </div>
        <button style={{ ...monoFont, fontSize: 12, color: "#14151A", background: C.paper, border: "none", borderRadius: 6, padding: "6px 12px", fontWeight: 700 }}>Apply</button>
      </div>
    </div>
  );
}
