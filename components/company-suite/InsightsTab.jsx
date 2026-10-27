"use client";
import { useEffect, useState } from "react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Stat, Grid, Pill, Bar, Err, muted, on, Locked } from "./ui";

const fmt = (n) => (n == null ? "—" : Number(n).toLocaleString());
export default function InsightsTab({ id, meta }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { if (on(meta, "insights")) api.suite(id, "insights").then(setD).catch((e) => setErr(e.message)); }, [id, meta]);
  if (!on(meta, "insights")) return <Locked id={id} feature="insights" what="Insights" />;
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  const max = Math.max(1, ...d.weekly.map((w) => w.n));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Story volume and themes (180 days)" sub={d.note}>
        <Stat label="Stories" value={d.stories180} />
        <div className="flex items-end gap-1" style={{ height: 70 }} role="img" aria-label="Weekly stories">{d.weekly.map((w) => <div key={w.week} title={`${w.week}: ${w.n}`} style={{ flex: 1, background: C.mustard, borderRadius: 3, height: `${Math.max(6, (w.n / max) * 100)}%` }} />)}</div>
        <div className="flex gap-1.5 flex-wrap">{d.themes.map((t) => <Pill key={t.key}>{t.label} · {t.reports}</Pill>)}{!d.themes.length && <span style={muted}>No theme has 2 or more reports yet.</span>}</div>
        {d.patterns.map((p) => <div key={p.theme} style={{ fontSize: 14, color: C.text }}>• {p.text}</div>)}
      </Card>

      {d.askBeforeJoining.length > 0 && <Card title="Questions candidates are being encouraged to ask" sub="The best response is an honest, official answer. Add them to your FAQ in the Employer tab; they're shown as “Company says”, never as employee testimony.">
        {d.askBeforeJoining.map((q) => <div key={q.theme} style={{ fontSize: 14, color: C.text }}>• “{q.question}” <span style={{ color: C.muted }}>({q.reports} people mentioned it)</span></div>)}</Card>}

      {on(meta, "hiring_analytics") && <Card title="Hiring and interview experience" sub="Aggregate only, from interview and ghosting stories. Separate from employee experience.">
        {d.hiring?.ready ? <><Grid><Stat label="Hiring experience" value={d.hiring.score} sub="0–100" /><Stat label="Positive / neutral / negative" value={`${d.hiring.positive} / ${d.hiring.neutral} / ${d.hiring.negative}`} /><Stat label="Ghosted" value={`${d.hiring.ghostedPct}%`} /><Stat label="Average rounds" value={d.hiring.avgRounds ?? "—"} /></Grid>
          {d.hiring.concerns.length > 0 && <div style={{ fontSize: 14, color: C.text }}>Candidate concerns: {d.hiring.concerns.map((c) => `${c.label} (${c.reporters})`).join(", ")}</div>}</>
          : <div style={muted}>Shown once at least 5 interview reports exist ({d.hiring?.stories ?? 0} so far). Candidate feedback surveys are coming.</div>}
      </Card>}

      {on(meta, "salary_intel") && d.salary && <Card title="Salary intelligence" sub={d.salary.note}>
        <Grid><Stat label="Pay submissions" value={d.salary.submissions} />
          {d.salary.overall && <Stat label="Middle 50% (all roles)" value={`${fmt(d.salary.overall.p25)}–${fmt(d.salary.overall.p75)}`} sub={`median ${fmt(d.salary.overall.median)}`} />}</Grid>
        {d.salary.roles.map((r) => <div key={r.role} className="flex justify-between flex-wrap" style={{ fontSize: 14, color: C.text }}><span style={{ textTransform: "capitalize" }}>{r.role} <span style={{ color: C.muted }}>({r.n})</span></span><span style={monoFont}>{fmt(r.p25)}–{fmt(r.p75)} · median {fmt(r.median)}</span></div>)}
        {d.salary.hiddenRoles > 0 && <div style={muted}>{d.salary.hiddenRoles} role group(s) hidden: fewer than 5 people, which could identify someone.</div>}
        {d.salary.vsIndustry?.length > 0 && <><div className="lo-eyebrow">Versus your industry (roles with 5+ submissions across 3+ companies)</div>{d.salary.vsIndustry.map((r) => <div key={r.role} className="flex justify-between" style={{ fontSize: 14, color: C.text }}><span style={{ textTransform: "capitalize" }}>{r.role}</span><span style={monoFont}>you {fmt(r.you)} · industry {fmt(r.industryMedian)} · {r.diffPct > 0 ? "+" : ""}{r.diffPct}%</span></div>)}</>}
        {d.salary.level === "basic" && <div style={muted}>Role-level ranges are part of Business; industry comparison is part of Business Pro.</div>}
      </Card>}

      {on(meta, "benchmarks") ? d.benchmark && <Card title="You vs your industry" sub={d.benchmark.note}>
        {d.benchmark.ready ? <>
          <div style={{ fontSize: 13, color: C.muted }}>{d.benchmark.peers} peer companies in {d.benchmark.industry}. Competitor groups, size and geography cuts are coming.</div>
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, color: C.text }}><thead><tr style={{ textAlign: "left", color: C.muted, fontSize: 12 }}><th style={{ padding: 6 }}>Metric</th><th>You</th><th>Industry median</th><th>Top 10%</th><th>Percentile</th></tr></thead>
            <tbody>{d.benchmark.metrics.map((m) => <tr key={m.key} style={{ borderTop: `1px solid ${C.line}` }}><td style={{ padding: 6 }}>{m.label}</td><td>{m.you ?? "—"}</td><td>{m.available ? m.median : "—"}</td><td>{m.available ? m.top10 : "—"}</td><td>{m.available ? `${m.percentile}th` : <span style={{ color: C.muted }}>not enough data</span>}</td></tr>)}</tbody></table></div></> : <div style={muted}>{d.benchmark.note}</div>}
      </Card> : <Locked id={id} feature="benchmarks" what="Industry benchmarks and competitor comparison" />}

      {on(meta, "claim_consistency") && d.claims && <Card title="Job-claim consistency" sub="What you advertise versus what people report. Reports are not proof either way.">
        {d.claims.length ? d.claims.map((c, i) => <div key={i} style={{ fontSize: 14, color: C.text }}><Pill color={c.status === "differs" ? C.flag : c.status === "aligned" ? C.green : C.mustard}>{c.label}</Pill> {c.topic ? `${c.topic}: ` : ""}{c.claim}</div>) : <div style={muted}>No claims yet. Add them in the Employer tab.</div>}
      </Card>}
    </div>
  );
}
