"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState, useRef } from "react";
import { C, displayFont } from "@/lib/theme";
import { adminApi } from "@/components/admin/adminApi";
import Link from "next/link";
import { Stat, Sparkline, card, Pill, LiveDot, SectionHeading } from "@/components/admin/ui";
import LivePanel from "@/components/admin/LivePanel";

const K = [
  ["Total users", "totalUsers"], ["Daily active", "dau"], ["Monthly active", "mau"], ["Online now", "onlineNow"], ["Signups today", "newToday"], ["Signups this week", "newWeek"],
  ["Posts today", "postsToday"], ["Reposts today", "repostsToday"], ["Replies today", "commentsToday"], ["Likes today", "likesToday"], ["Reactions today", "reactionsToday"], ["Messages today", "messagesToday"], ["Media uploads today", "mediaToday"],
  ["Reports today", "reportsToday"], ["Reports pending", "reportsPending", "flag"], ["Appeals pending", "appealsPending"], ["Verifications pending", "verificationPending"],
  ["Suspended", "suspended"], ["Restricted", "restricted"], ["Locked", "locked"], ["Content removed", "contentRemoved"], ["Spam flagged", "spamFlagged"],
  ["Subscribers", "subscribers"], ["MRR (est. $)", "mrrEstimate"],
  ["Stories today", "storiesToday"], ["Stories total", "storiesTotal"], ["“Me too” today", "meTooToday"], ["Story reports open", "storyReportsOpen", "flag"], ["Employment docs pending", "employmentPending"], ["Active circles", "circlesCount"], ["Business plans", "businessPlansActive"],
];
const CH = [["Posts / min", "posts"], ["Reposts / min", "reposts"], ["Likes / min", "likes"], ["Reactions / min", "reactions"], ["Replies / min", "replies"]];

export default function CommandCenter() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const timer = useRef();
  useEffect(() => {
    let dead = false;
    const load = () => adminApi.get("overview").then((x) => { if (!dead) { setD(x); setErr(""); } }).catch((e) => !dead && setErr(e.message));
    load(); timer.current = setInterval(load, 5000);
    return () => { dead = true; clearInterval(timer.current); };
  }, []);
  if (err && !d) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <Loading />;
  const h = d.health;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <div><h1 style={{ ...displayFont, fontSize: 28, letterSpacing: "-0.02em", margin: 0 }}>Command Center</h1><div style={{ fontSize: 13.5, color: C.muted, marginTop: 3 }}>Everything happening on LinkedOut, as it happens.</div></div>
        <div style={{ fontSize: 12, color: C.muted }}><span style={{ color: C.green, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><LiveDot /> LIVE</span> · DB {h.dbLatencyMs}ms · {h.status} · uptime {Math.round(h.uptimeSec / 60)}m · refreshes every 5s</div>
      </div>
      <LivePanel />
      <SectionHeading>Activity · last 30 minutes</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 6 }}>
        {CH.map(([l, k]) => (
          <div key={k} className="lo-adm-card lo-rise" style={card}>
            <div style={{ fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>{l}<b>{d.series[k].slice(-1)[0] ?? 0}</b></div>
            <Sparkline data={d.series[k]} />
            <div style={{ fontSize: 12, color: C.muted }}>last 30 min</div>
          </div>
        ))}
      </div>
      <SectionHeading>Attention &amp; trends</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12, marginBottom: 6 }}>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Needs attention</div>
          {[["Open reports", d.attention.reports, "reports"], ["Pending appeals", d.attention.appeals, "appeals"], ["Verification requests", d.attention.verification, "verification"], ["Unassigned tickets", d.attention.support, "support"], ["Ads awaiting review", d.attention.adreview, "adreview"], ["DM abuse reports", d.attention.dm, "dm"], ["Company claims", d.attention.companies, "companies"], ["DMCA notices", d.attention.dmca, "dmca"], ["Legal requests", d.attention.legal, "legal"]].map(([l, n, href]) => (
            <Link key={l} href={`/admin/${href}`} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13, textDecoration: "none", color: C.text, borderTop: `1px solid ${C.line}` }}><span>{l}</span><b style={{ color: n > 0 ? C.flag : C.muted }}>{n}</b></Link>
          ))}
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Daily active users · 14 days</div>
          <Sparkline data={d.trends.dau} height={64} />
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 10 }}>New signups · 14 days</div>
          <Sparkline data={d.trends.signups} height={64} />
          <div style={{ fontSize: 12, color: C.muted }}>{d.trends.days[0]} → {d.trends.days[13]}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Recent staff activity</div>
          {d.recent.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nothing yet.</div>}
          {d.recent.map((r, i) => <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}><b>{r.who}</b> <span style={{ color: C.muted }}>{r.action} {r.target}</span><div style={{ fontSize: 12, color: C.muted }}>{String(r.at).slice(0, 16).replace("T", " ")}</div></div>)}
        </div>
      </div>
      <SectionHeading>All numbers</SectionHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(176px,1fr))", gap: 12 }}>
        {K.map(([l, k, tone]) => <Stat key={k} label={l} value={d.kpis[k]} tone={tone && d.kpis[k] > 0 ? C[tone] : undefined} />)}
      </div>
    </div>
  );
}
