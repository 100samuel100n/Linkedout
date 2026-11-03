"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { C } from "@/lib/theme";
import { api } from "@/lib/api";
import JobCardV2 from "@/components/jobs/JobCardV2";

// "Story → Company → Jobs" and "Job → Company → Stories": open positions on the company page.
export default function CompanyJobs({ companyId, companyName }) {
  const [d, setD] = useState(null);
  useEffect(() => { api.jobsSearch(`companyId=${companyId}&sort=newest`).then(setD).catch(() => {}); }, [companyId]);
  if (!d || !d.jobs.length) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Open positions">
      <div className="flex items-center gap-2"><h2 style={{ margin: 0, fontSize: 18, fontWeight: 740, color: C.text }}>Open positions at {companyName}</h2><Link href={`/jobs?company=${encodeURIComponent(companyName)}`} style={{ marginLeft: "auto", fontSize: 13, color: C.corpblue }}>All jobs</Link></div>
      {d.jobs.slice(0, 5).map((j) => <JobCardV2 key={j.id} job={j} />)}
      <div style={{ fontSize: 12.5, color: C.muted }}>Read what people report below before you apply.</div>
    </section>
  );
}
