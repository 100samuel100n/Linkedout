"use client";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Award } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Stat, Grid, Pill, Bar, Locked, Err, scoreColor, muted } from "./ui";

function Spark({ points }) {
  const pts = points.map((p, i) => ({ ...p, i })).filter((p) => p.score != null);
  if (pts.length < 2) return <div style={muted}>A trend line appears once there are two months with enough stories.</div>;
  const w = 560, h = 90, n = points.length - 1, min = Math.min(...pts.map((p) => p.score)) - 5, max = Math.max(...pts.map((p) => p.score)) + 5;
  const x = (i) => (i / n) * (w - 20) + 10, y = (s) => h - 14 - ((s - min) / Math.max(1, max - min)) * (h - 28);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 100 }} role="img" aria-label="Reputation health by month">
      <polyline fill="none" stroke={C.mustard} strokeWidth="2.5" points={pts.map((p) => `${x(p.i)},${y(p.score)}`).join(" ")} />
      {pts.map((p) => <g key={p.month}><circle cx={x(p.i)} cy={y(p.score)} r="3.5" fill={C.mustard} /><title>{`${p.month}: ${p.score}`}</title></g>)}
      <text x="10" y={h - 1} fontSize="10" fill={C.muted}>{points[0].month}</text><text x={w - 10} y={h - 1} fontSize="10" textAnchor="end" fill={C.muted}>{points[n].month}</text>
    </svg>
  );
}
const Dir = ({ d }) => (d === "up" ? <TrendingUp size={18} color={C.green} /> : d === "down" ? <TrendingDown size={18} color={C.flag} /> : <Minus size={18} color={C.muted} />);

export default function Overview({ id, meta, go }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { api.suite(id, "overview").then(setD).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <Err>{err}</Err>;
  if (!d) return <Loading variant="cards" />;
  const h = d.health, r = d.response, pn = d.positiveNegative;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Reputation health" sub={h.note}>
        <div className="flex items-center gap-4 flex-wrap">
          <div style={{ fontSize: 34, fontWeight: 800, color: scoreColor(h.score) }}>{h.label}</div>
          {h.score != null && <div style={{ ...monoFont, fontSize: 14, color: C.muted }}>{h.score}/100 · visible to your team only. The public sees the label.</div>}
          {d.trend && d.trend.direction !== "unknown" && <div className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}><Dir d={d.trend.direction} />{d.trend.text}</div>}
        </div>
        {h.score != null && <Grid min={200}>{h.components.map((c) => <div key={c.key}><div className="flex justify-between" style={{ fontSize: 13, color: C.text2 }}><span>{c.label}</span><span style={monoFont}>{c.score ?? "—"}</span></div><Bar value={c.score} color={scoreColor(c.score)} /></div>)}</Grid>}
        {h.score == null && <div style={muted}>Health appears once at least 8 stories and 3 components have enough data. Until then there is nothing to score, and nothing is hidden from anyone.</div>}
      </Card>

      <Grid>
        <Stat label="Stories this month" value={d.counts.storiesMonth} sub={`${d.counts.storiesPrev} the month before`} />
        <Stat label="Unanswered stories" value={d.counts.unanswered} tone={d.counts.unanswered ? C.flag : undefined} sub="last 180 days" />
        <Stat label="Response rate" value={r.rate != null ? `${r.rate}%` : "—"} />
        <Stat label="Median response time" value={r.medianHours != null ? (r.medianHours < 48 ? `${r.medianHours}h` : `${Math.round(r.medianHours / 24)}d`) : "—"} />
        <Stat label="Positive / negative (30d)" value={`${pn.positive} / ${pn.negative}`} sub={`before: ${pn.prevPositive} / ${pn.prevNegative}`} />
        {meta.features.benchmarks && <Stat label="Reputation percentile" value={d.percentile != null ? `${d.percentile}th` : "—"} sub="in your industry" />}
      </Grid>

      <Card title="Company Response Score" sub={r.note}>
        <div className="flex items-center gap-3 flex-wrap"><div style={{ fontSize: 22, fontWeight: 780, color: scoreColor(r.score) }}>{r.label}</div>{r.score != null && <Pill color={scoreColor(r.score)}>{r.score}/100</Pill>}</div>
        {r.eligible && <div style={{ ...muted }}>Reply rate {r.rate ?? "—"}% · consistency {r.consistency ?? "—"}% · candidate replies {r.candidateRate ?? "—"}% · transparency {r.transparency}%. A company with problems can still be Highly Responsive.</div>}
      </Card>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card title="Most common issues (90 days)">
          {d.topIssues.length ? d.topIssues.map((t) => <div key={t.theme} className="flex justify-between" style={{ fontSize: 14, color: C.text }}><span>{t.label}</span><span style={monoFont}>{t.reporters} people</span></div>) : <div style={muted}>No issue has 3 or more reports yet.</div>}
          {d.emerging && <div style={{ fontSize: 13.5, color: C.text, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}><b>Most concerning emerging issue:</b> {d.emerging.label} ({d.emerging.before} → {d.emerging.reporters} people).</div>}
          {meta.features.improvement && d.topIssues.length > 0 && <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => go("improve")}>Start an improvement initiative</button>}
        </Card>
        <Card title="Job-claim consistency">
          {d.claims.length ? d.claims.map((c, i) => <div key={i} style={{ fontSize: 14, color: C.text }}><Pill color={c.status === "differs" ? C.flag : c.status === "aligned" ? C.green : c.status === "mixed" ? C.mustard : C.muted}>{c.status === "differs" ? "Reports differ" : c.status === "aligned" ? "Consistent" : c.status === "mixed" ? "Mixed reports" : "Not enough reports"}</Pill> {c.topic ? `${c.topic}: ` : ""}{c.claim}</div>) : <div style={muted}>Publish what you advertise (e.g. “Flexible remote work”) from the Employer tab. Candidates will see it next to what people report.</div>}
        </Card>
      </div>

      {d.gates.changes ? (
        <Card title="What changed this month" sub={d.changed.window}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div><div className="lo-eyebrow" style={{ color: C.green }}>Positive</div>{d.changed.positive.length ? d.changed.positive.map((x) => <div key={x.theme} style={{ fontSize: 14, color: C.text, marginTop: 4 }}>• {x.text}</div>) : <div style={muted}>Nothing notable.</div>}</div>
            <div><div className="lo-eyebrow" style={{ color: C.flag }}>Needs attention</div>{d.changed.attention.length ? d.changed.attention.map((x) => <div key={x.theme} style={{ fontSize: 14, color: C.text, marginTop: 4 }}>• {x.text}</div>) : <div style={muted}>Nothing notable.</div>}</div>
          </div>
        </Card>
      ) : <Locked id={id} feature="what_changed" what="“What changed this month”" />}

      {d.gates.trends ? (
        <Card title="12-month reputation history" sub="History is permanent: a month is stored once it ends. Subscribing, or cancelling, never changes the past.">
          <Spark points={d.trend.points} />
          {d.sentiment && <div style={muted}>Employee sentiment (current and former employees, positive share): {d.sentiment.map((s) => `${s.month.slice(5)}: ${s.positivePct != null ? s.positivePct + "%" : "—"}`).join(" · ")}</div>}
        </Card>
      ) : <Locked id={id} feature="reputation_trends" what="Reputation trends and history" />}

      <Card title="Recognition" sub="Earned from your own record, never purchased. Each has public criteria.">
        <Grid min={240}>{d.badges.map((b) => <div key={b.key} style={{ background: b.earned ? "var(--lo-green-soft, rgba(0,160,90,.10))" : C.surface2, borderRadius: 12, padding: 12, opacity: b.earned ? 1 : 0.75 }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 700, color: C.text, fontSize: 14 }}><Award size={15} color={b.earned ? C.green : C.muted} />{b.label}</div>
          <div style={{ ...muted, marginTop: 4 }}>{b.criteria}</div><div style={{ marginTop: 6 }}><Pill color={b.earned ? C.green : C.muted}>{b.earned ? "Earned" : "Not yet"}</Pill></div></div>)}</Grid>
      </Card>
    </div>
  );
}
