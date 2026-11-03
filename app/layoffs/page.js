"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TrendingDown, ShieldCheck, Users } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";

function Tracker() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { const h = setTimeout(() => api.getLayoffTracker(q).then(setData).catch((e) => setErr(e.message)), 250); return () => clearTimeout(h); }, [q]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Layoff Tracker" title="Who is laying off, according to the people affected" subtitle="Two kinds of information, kept strictly apart. User-reported comes from people's own experience. Publicly documented has a source we link to." />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        <div className="lo-card" style={{ padding: 12 }}><div style={{ ...monoFont, fontSize: 12.5, fontWeight: 700, color: C.mustard }}><Users size={13} style={{ display: "inline" }} /> User-reported</div><div style={{ fontSize: 13.5, color: C.muted }}>Shared by users about their own layoff. Not independently confirmed.</div></div>
        <div className="lo-card" style={{ padding: 12 }}><div style={{ ...monoFont, fontSize: 12.5, fontWeight: 700, color: C.green }}><ShieldCheck size={13} style={{ display: "inline" }} /> Publicly documented</div><div style={{ fontSize: 13.5, color: C.muted }}>Backed by news, filings or regulator notices, with the source linked.</div></div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a company" aria-label="Search a company" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "11px 14px", fontSize: 15 }} />
      {!data && !err && <Loading variant="cards" />}
      {err && <div style={{ color: C.flag, fontSize: 13 }}>{err}</div>}
      {data?.companies.length === 0 && <div className="lo-card"><EmptyState icon={TrendingDown} title="Nothing reported yet" actionLabel="I was laid off" href="/stories/new?format=laid_off">If you were laid off, sharing helps others see what's happening.</EmptyState></div>}
      {data?.companies.map((c) => (
        <article key={c.companyKey} className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
          <div className="flex items-baseline gap-2 flex-wrap"><h2 style={{ margin: 0, fontSize: 18, fontWeight: 720, color: C.text }}>{c.companyId ? <Link href={`/companies/${c.companyId}`} style={{ color: C.text, textDecoration: "none" }}>{c.company}</Link> : c.company}</h2></div>
          {c.userReported && (
            <div style={{ borderLeft: `3px solid ${C.mustard}`, paddingLeft: 10 }}>
              <div style={{ ...monoFont, fontSize: 12.5, fontWeight: 700, color: C.mustard }}>User-reported</div>
              <div style={{ fontSize: 14.5, color: C.text }}>{c.userReported.reporters} {c.userReported.reporters === 1 ? "person reports" : "people report"} being laid off{c.userReported.verifiedEmployees ? ` (${c.userReported.verifiedEmployees} verified employees)` : ""}. First report {c.userReported.firstReported}, latest {c.userReported.lastReported}.{c.userReported.estimatedAffected ? ` Estimated company-wide: about ${c.userReported.estimatedAffected} (${c.userReported.estimateBasis}).` : ""}</div>
              {c.userReported.departments.length > 0 && <div style={{ fontSize: 13.5, color: C.muted }}>Departments: {c.userReported.departments.map((d) => `${d.name} (${d.n})`).join(", ")}</div>}
              {c.userReported.locations.length > 0 && <div style={{ fontSize: 13.5, color: C.muted }}>Locations: {c.userReported.locations.map((d) => `${d.name} (${d.n})`).join(", ")}</div>}
            </div>
          )}
          {c.documented && (
            <div style={{ borderLeft: `3px solid ${C.green}`, paddingLeft: 10 }}>
              <div style={{ ...monoFont, fontSize: 12.5, fontWeight: 700, color: C.green }}>Publicly documented</div>
              {c.documented.records.map((r) => <div key={r.id} style={{ fontSize: 14.5, color: C.text }}>{r.summary}{r.headcount ? ` (${r.headcount} roles)` : ""} · <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue }}>{r.source}</a>{r.date ? ` · ${r.date}` : ""}</div>)}
            </div>
          )}
          <Link href={`/?format=laid_off`} style={{ ...monoFont, fontSize: 12.5, color: C.mustard, textDecoration: "none" }}>Read the stories →</Link>
        </article>
      ))}
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading variant="cards" />}><Tracker /></Suspense>; }
