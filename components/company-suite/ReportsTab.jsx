"use client";
import { useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import { Card, Stat, Grid, Err, inp, muted, can, on, Locked } from "./ui";

const iso = (d) => d.toISOString().slice(0, 10);
export function ReportBody({ r }) {
  return (<div className="flex flex-col gap-3">
    <Grid><Stat label="Stories" value={r.stories} /><Stat label="Answered" value={r.answered} /><Stat label="Unanswered" value={r.unanswered} /><Stat label="Median response" value={r.medianResponseHours != null ? `${r.medianResponseHours}h` : "—"} /></Grid>
    <div style={{ fontSize: 14, color: C.text }}>Reputation health: <b>{r.health.label}</b>{r.health.score != null ? ` (${r.health.score})` : ""} · Response: <b>{r.response.label}</b>{r.response.rate != null ? ` (${r.response.rate}% answered)` : ""}</div>
    <div style={{ fontSize: 14, color: C.text }}>{r.trend}</div>
    {r.themes.length > 0 && <div><div className="lo-eyebrow">Themes (people)</div>{r.themes.map((t) => <div key={t.theme} className="flex justify-between" style={{ fontSize: 14, color: C.text }}><span>{t.theme}</span><span style={monoFont}>{t.reporters}</span></div>)}</div>}
    {(r.changed.positive.length > 0 || r.changed.attention.length > 0) && <div><div className="lo-eyebrow">What changed</div>{[...r.changed.positive, ...r.changed.attention].map((x) => <div key={x.theme} style={{ fontSize: 14, color: C.text }}>• {x.text}</div>)}</div>}
    {r.initiatives.length > 0 && <div><div className="lo-eyebrow">Improvement initiatives</div>{r.initiatives.map((i, k) => <div key={k} style={{ fontSize: 14, color: C.text }}>• {i.title} ({i.status.replace("_", " ")}): {i.text}</div>)}</div>}
    <div style={muted}>{r.note} Generated {r.generatedAt.slice(0, 10)}.</div></div>);
}
export default function ReportsTab({ id, meta }) {
  const today = new Date(); const [from, setFrom] = useState(iso(new Date(today - 30 * 864e5))); const [to, setTo] = useState(iso(today)); const [r, setR] = useState(null); const [err, setErr] = useState(null);
  const pro = on(meta, "pdf");
  const load = () => { setErr(null); api.suite(id, "reports", pro ? { from, to } : {}).then(setR).catch((e) => setErr(e.message)); };
  useEffect(() => { if (on(meta, "reports_basic")) load(); /* eslint-disable-next-line */ }, [id]);
  if (!on(meta, "reports_basic")) return <Locked id={id} feature="reports_basic" what="Reports" />;
  const preset = (days) => { setFrom(iso(new Date(Date.now() - days * 864e5))); setTo(iso(new Date())); };
  const qs = `from=${from}&to=${to}`;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Report" sub="Aggregates only. Nothing here identifies an author, a salary submitter or a voter.">
        {pro ? <div className="flex gap-2 flex-wrap items-center">
          <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => preset(30)}>Monthly</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => preset(90)}>Quarterly</button>
          <input type="date" style={{ ...inp, width: "auto" }} value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" style={{ ...inp, width: "auto" }} value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={load}>Update</button></div> : <div style={muted}>The last 30 days. Custom date ranges, monthly and quarterly reports, CSV and PDF are part of Business Pro.</div>}
        <Err>{err}</Err>
        {r ? <ReportBody r={r} /> : !err && <Loading variant="cards" />}
        {pro && can(meta, "reports.export") && <div className="flex gap-2 flex-wrap">
          <a className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }} href={`/api/companies/${id}/suite?view=export&kind=summary&${qs}`}><Download size={13} /> Summary CSV</a>
          <a className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }} href={`/api/companies/${id}/suite?view=export&kind=stories`}><Download size={13} /> Stories CSV (no authors)</a>
          <a className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }} href={`/api/companies/${id}/suite?view=export&kind=history`}><Download size={13} /> Reputation history CSV</a>
          <a className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }} href={`/companies/${id}/report?${qs}`} target="_blank"><Printer size={13} /> Print / save as PDF</a></div>}
        <div style={muted}>Scheduled reports and automated delivery are on the Enterprise roadmap.</div>
      </Card>
    </div>
  );
}
