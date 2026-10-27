"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PenLine, TrendingDown, Sparkles, Lock } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { StoryCard, Chip } from "@/components/stories/StoryBits";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";
import Select from "@/components/ui/Select";

const Card = ({ title, sub, children, id }) => (
  <section id={id} className="lo-card flex flex-col gap-3" style={{ padding: 16 }}>
    <div><h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>{title}</h2>{sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{sub}</div>}</div>
    {children}
  </section>
);
const Muted = ({ children }) => <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{children}</div>;
const KIND_COLOR = { reports: C.mustard, positive: C.green, public: C.corpblue, company: C.corpblue };

export default function CompanyReality({ companyId, companyName, initialReality = null, initialStories = null }) {
  const { user } = useAuth();
  const [r, setR] = useState(initialReality);
  const [stories, setStories] = useState(initialStories || []);
  const [tab, setTab] = useState("");
  const [err, setErr] = useState(null);
  const [claim, setClaim] = useState({ topic: "", claim: "" });
  const [ai, setAi] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState({ storyId: null, body: "" });
  const load = () => api.getCompanyReality(companyId).then(setR).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [companyId]); // eslint-disable-line
  useEffect(() => { api.getStories({ companyId, limit: 10, format: tab }).then((x) => setStories(x.stories)).catch(() => {}); }, [companyId, tab]);

  async function run(mode) {
    setAiBusy(true); setAi(null); setErr(null);
    try { setAi(await api.intelligence({ mode, companyId, question })); } catch (e) { setErr(e.message); setAi({ locked: e.code === "PLAN_REQUIRED" }); } finally { setAiBusy(false); }
  }
  async function addClaim() { try { await api.addCompanyClaim(companyId, claim); setClaim({ topic: "", claim: "" }); load(); } catch (e) { setErr(e.message); } }
  async function check(id, verdict) { try { await api.checkClaim(id, { verdict }); load(); } catch (e) { setErr(e.status === 401 ? "Log in to add a Reality Check." : e.message); } }
  async function sendReply() { try { await api.respondAsCompany(companyId, reply); setReply({ storyId: null, body: "" }); load(); } catch (e) { setErr(e.message); } }

  if (!r) return err ? <ErrorNote>{err}</ErrorNote> : <Loading variant="cards" />;
  const { counts } = r;
  const empty = counts.stories === 0;
  return (
    <div className="flex flex-col gap-4">
      <Card title={`What employees are saying about ${companyName}`} sub="Reality, from the people who were there. Not a rating.">
        <div className="flex gap-4 flex-wrap" style={{ ...monoFont, fontSize: 13, color: C.text2 }}>
          <span><b style={{ color: C.text, fontSize: 18 }}>{counts.stories}</b> stories</span>
          <span><b style={{ color: C.text, fontSize: 18 }}>{counts.former}</b> former employees</span>
          <span><b style={{ color: C.text, fontSize: 18 }}>{counts.current}</b> current employees</span>
        </div>
        <Muted>Employee status is self-declared unless a story says “Verified”. Anyone can speak without revealing who they are.</Muted>
        <div className="flex gap-2 flex-wrap">
          <Link href={user ? `/stories/new?company=${encodeURIComponent(companyName)}` : "/login"} className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}><PenLine size={16} /> Tell us what happened here</Link>
          {r.company.verifiedRep && <Link href={`/companies/${companyId}/dashboard`} className="lo-btn lo-btn-secondary" style={{ textDecoration: "none" }}>Command Center</Link>}
          {user && <Link href="/verify-employment" className="lo-btn lo-btn-ghost" style={{ textDecoration: "none" }}>Work here? Get verified</Link>}
          <Link href={`/layoffs?q=${encodeURIComponent(companyName)}`} className="lo-btn lo-btn-secondary" style={{ textDecoration: "none" }}><TrendingDown size={16} /> Layoffs</Link>
        </div>
        {empty && <Muted>No one has shared a story about this company yet. If you've worked here, interviewed here or been let go, you could be the first.</Muted>}
      </Card>

      {r.patterns.length > 0 && (
        <Card title="Emerging workplace patterns" sub="Needs at least 5 independent reports within 90 days.">
          {r.patterns.map((p) => <div key={p.theme} style={{ background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 35)}`, borderRadius: 12, padding: "10px 12px", fontSize: 14.5, color: C.text }}>{p.text}</div>)}
          <Muted>This describes what users reported. It is not a finding that the company has done anything.</Muted>
        </Card>
      )}

      {(r.exitWave || r.concerns.length > 0 || r.positives.reports > 0) && (
        <Card title="Before you join" sub="A balanced snapshot of what people report.">
          {r.positives.reports > 0 && <div style={{ fontSize: 14.5, color: C.text }}>💚 {r.positives.reports} people shared positive experiences.</div>}
          {r.exitWave && <div style={{ fontSize: 14.5, color: C.text }}><b>{r.exitWave.label}.</b> {r.exitWave.text}</div>}
          {r.askBeforeJoining.length > 0 && <>
            <div style={{ fontSize: 14, fontWeight: 650, color: C.text }}>Things worth asking before accepting</div>
            {r.askBeforeJoining.map((q) => <div key={q.theme} style={{ fontSize: 14.5, color: C.text }}>“{q.question}” <span style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>({q.basis})</span></div>)}
          </>}
        </Card>
      )}

      {r.claims.length > 0 || user ? (
        <Card title="Company claims and the Truth Gap" sub="What a company says, next to what people report. Companies can respond; nobody is called a liar.">
          {r.claims.map((c) => (
            <div key={c.id} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }} className="flex flex-col gap-2">
              <div style={{ fontSize: 15, color: C.text }}>“{c.claim}” <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>· {c.source === "company" ? "published by the company" : "quoted by a user"} · {c.time}</span></div>
              <div style={{ ...monoFont, fontSize: 13, color: C.text2 }}>Truth Gap: <b style={{ color: c.truthGap.status === "differs" ? C.flag : c.truthGap.status === "aligned" ? C.green : C.mustard }}>{c.truthGap.label}</b>{c.truthGap.recentReports > 0 && ` · ${c.truthGap.recentReports} related reports in the last year`}</div>
              <div className="flex gap-2 flex-wrap items-center" style={{ fontSize: 13, color: C.muted }}>
                <span>Reality check: {c.checks.matches} match · {c.checks.mixed} mixed · {c.checks.differs} differ</span>
                {user && ["matches", "mixed", "differs"].map((v) => <button key={v} onClick={() => check(c.id, v)} className="lo-btn lo-btn-ghost lo-btn-sm">{v === "matches" ? "It matches" : v === "mixed" ? "Mixed" : "It differs"}</button>)}
              </div>
            </div>
          ))}
          {user && (
            <div className="flex gap-2 flex-wrap">
              <input value={claim.claim} onChange={(e) => setClaim({ ...claim, claim: e.target.value })} placeholder="“Company X says it has unlimited PTO.”" style={{ flex: 1, minWidth: 220, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14 }} />
              <Select value={claim.topic} onChange={(e) => setClaim({ ...claim, topic: e.target.value })} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 9, fontSize: 13.5 }}>
                <option value="">Topic (optional)</option>{["Work-life balance", "Flexibility / remote work", "Stability / growth", "Pay and fairness", "Culture / management", "Promotions / career growth"].map((t) => <option key={t}>{t}</option>)}
              </Select>
              <button onClick={addClaim} disabled={claim.claim.trim().length < 8} className="lo-btn lo-btn-secondary lo-btn-sm">Add a claim</button>
            </div>
          )}
        </Card>
      ) : null}

      {(r.layoffs.userReported.reporters > 0 || r.layoffs.documented.length > 0) && (
        <Card title="Layoffs" sub="User-reported and publicly documented are kept separate.">
          {r.layoffs.userReported.reporters > 0 && <div style={{ fontSize: 14.5, color: C.text }}><b>User-reported:</b> {r.layoffs.userReported.reporters} users. {r.layoffs.userReported.departments.length > 0 && <>Departments: {r.layoffs.userReported.departments.map((d) => d.name).join(", ")}. </>}{r.layoffs.userReported.locations.length > 0 && <>Locations: {r.layoffs.userReported.locations.map((d) => d.name).join(", ")}.</>}</div>}
          {r.layoffs.documented.map((d, i) => <div key={i} style={{ fontSize: 14.5, color: C.text }}><b>Publicly documented:</b> {d.summary}{d.headcount ? ` (${d.headcount} roles)` : ""} · <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue }}>{d.source}</a></div>)}
        </Card>
      )}

      {r.leaving.responses > 0 && (
        <Card title="Why people left" sub={r.leaving.note || `${r.leaving.responses} people answered, shown anonymously.`}>
          {r.leaving.breakdown.map((b) => <div key={b.reason} className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}><span style={{ width: 40, ...monoFont, color: C.text2 }}>{b.pct}%</span><div style={{ flex: 1, height: 8, background: C.surface2, borderRadius: 99 }}><div style={{ width: `${b.pct}%`, height: 8, background: C.mustard, borderRadius: 99 }} /></div><span style={{ width: 130 }}>{b.reason}</span></div>)}
        </Card>
      )}

      {(r.interviews.stories > 0 || r.salary.reports > 0) && (
        <Card title="Interview and salary reality">
          {r.interviews.stories > 0 && <div style={{ fontSize: 14.5, color: C.text }}>{r.interviews.stories} interview stories{r.interviews.avgRounds ? ` · about ${r.interviews.avgRounds} rounds on average` : ""}{r.interviews.ghosted ? ` · ${r.interviews.ghosted} people say they were ghosted` : ""}.</div>}
          {r.salary.reports > 0 && <div style={{ fontSize: 14.5, color: C.text }}>{r.salary.gapPct !== null ? `Final pay was on average ${r.salary.gapPct}% ${r.salary.gapPct < 0 ? "below" : "vs"} the advertised figure.` : r.salary.note} ({r.salary.reports} reports)</div>}
        </Card>
      )}

      {(r.flags.red.length > 0 || r.flags.green.length > 0 || r.notInJd.length > 0) && (
        <Card title="Red flags and green flags">
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <div><div className="lo-eyebrow">🚩 Most reported</div>{r.flags.red.map((f) => <div key={f.name} style={{ fontSize: 14, color: C.text }}>{f.name} <span style={{ color: C.muted }}>· {f.n}</span></div>)}{!r.flags.red.length && <Muted>None reported.</Muted>}</div>
            <div><div className="lo-eyebrow">💚 They did the right thing</div>{r.flags.green.map((f) => <div key={f.name} style={{ fontSize: 14, color: C.text }}>{f.name} <span style={{ color: C.muted }}>· {f.n}</span></div>)}{!r.flags.green.length && <Muted>None reported.</Muted>}</div>
          </div>
          {r.notInJd.length > 0 && <div style={{ fontSize: 14, color: C.text }}><b>What wasn't in the job description:</b> {r.notInJd.map((x) => x.name).join(", ")}</div>}
        </Card>
      )}

      {r.index.ready ? (
        <Card title="Workplace Reality Index" sub="A summary of what was shared, not a star rating.">
          {r.index.rows.map((x) => <div key={x.label} className="flex items-center gap-3" style={{ fontSize: 14, color: C.text }}><span style={{ width: 150 }}>{x.label}</span><div style={{ flex: 1, height: 10, background: C.surface2, borderRadius: 99 }}><div style={{ width: `${x.value * 10}%`, height: 10, borderRadius: 99, background: x.higherIsWorse ? C.flag : C.green }} /></div><span style={{ ...monoFont, width: 40, color: C.muted }}>{x.value}/10</span></div>)}
          <Muted>{r.index.methodology}</Muted>
        </Card>
      ) : null}

      {r.timeline.length > 0 && (
        <Card title="Company Reality Timeline" sub="A record of what users reported over time, with documented events and the company's own statements.">
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>{r.timeline.map((t, i) => (
            <li key={i} className="flex gap-3" style={{ paddingBottom: 10 }}><span style={{ width: 10, height: 10, borderRadius: 99, background: KIND_COLOR[t.kind] || C.muted, marginTop: 6, flexShrink: 0 }} /><div><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{t.month}</div><div style={{ fontSize: 14.5, color: C.text }}>{t.text}{t.url && <> · <a href={t.url} target="_blank" rel="noopener noreferrer nofollow" style={{ color: C.corpblue }}>{t.source}</a></>}</div></div></li>
          ))}</ol>
        </Card>
      )}

      {(r.responses.explanations.length > 0 || r.company.verifiedRep) && (
        <Card title="Company response" sub="Verified company representatives can answer here. Responses appear next to stories, never instead of them.">
          {r.responses.explanations.map((e) => <div key={e.id} style={{ border: `1px solid ${alpha(C.corpblue, 40)}`, borderRadius: 12, padding: 12, fontSize: 14.5, color: C.text, whiteSpace: "pre-wrap" }}><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{e.date} · Here's our explanation</div>{e.body}</div>)}
          {r.company.verifiedRep && <div className="flex flex-col gap-2"><textarea rows={3} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} placeholder="Here's our explanation of what happened…" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14.5 }} /><div><button onClick={sendReply} className="lo-btn lo-btn-primary lo-btn-sm">Publish statement</button></div><Muted>To answer one story, use “Respond” beneath it. Businesses cannot remove, hide or edit stories, or see who posted them.</Muted></div>}
        </Card>
      )}

      <Card title="Intelligence" sub="AI summaries of this company's stories, always linked back to them.">
        <div className="flex gap-2 flex-wrap">
          <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={aiBusy} onClick={() => run("summary")}><Sparkles size={14} /> What people are saying <span style={{ opacity: .6 }}>OUT+</span></button>
          <button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={aiBusy} onClick={() => run("deep-dive")}><Sparkles size={14} /> Deep dive <span style={{ opacity: .6 }}>PRO</span></button>
        </div>
        <div className="flex gap-2 flex-wrap"><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pattern Explorer: “What are former employees saying that current employees aren't?”" style={{ flex: 1, minWidth: 220, background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 14 }} /><button className="lo-btn lo-btn-secondary lo-btn-sm" disabled={aiBusy || question.trim().length < 8} onClick={() => run("explorer")}>Ask <span style={{ opacity: .6 }}>PRO</span></button></div>
        {aiBusy && <Loading variant="inline" />}
        {ai?.locked && <Muted><Lock size={13} style={{ display: "inline", marginRight: 4 }} /> This is part of a paid plan. <Link href="/premium" style={{ color: C.mustard }}>See plans</Link>. The stories themselves are always free to read.</Muted>}
        {ai?.summary && <div className="flex flex-col gap-2"><div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.6 }}>{ai.summary.summary}</div>{ai.summary.points.map((p, i) => <div key={i} style={{ fontSize: 14, color: C.text }}>• {p.text} {p.storyIds.map((id, j) => <Link key={id} href={`/stories/${id}`} style={{ color: C.mustard, fontSize: 12.5 }}>[{j + 1}]</Link>)}</div>)}<Muted>{ai.summary.limits} Based on {ai.storyCount} stories.</Muted></div>}
        {ai?.note && <Muted>{ai.note}</Muted>}
      </Card>

      <Card title="Stories" id="stories">
        <div className="flex gap-1.5 flex-wrap overflow-x-auto"><Chip active={!tab} onClick={() => setTab("")}>All</Chip>{r.byFormat.map((f) => null)}
          {[["laid_off", "Layoffs"], ["interview", "Interviews"], ["salary", "Salary"], ["management", "Management"], ["red_flag", "Red flags"], ["green_flag", "Green flags"], ["quit", "Why people left"]].map(([k, l]) => <Chip key={k} active={tab === k} onClick={() => setTab(k)}>{l}</Chip>)}</div>
        {stories.length === 0 && <Muted>No stories in this view yet.</Muted>}
        {stories.map((s) => <div key={s.id}><StoryCard story={s} />{r.company.verifiedRep && <div style={{ marginTop: 6 }}>{reply.storyId === s.id ? <div className="flex flex-col gap-2"><textarea rows={3} value={reply.body} onChange={(e) => setReply({ storyId: s.id, body: e.target.value })} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14.5 }} /><div className="flex gap-2"><button onClick={sendReply} className="lo-btn lo-btn-primary lo-btn-sm">Publish response</button><button onClick={() => setReply({ storyId: null, body: "" })} className="lo-btn lo-btn-ghost lo-btn-sm">Cancel</button></div></div> : <button onClick={() => setReply({ storyId: s.id, body: "" })} className="lo-btn lo-btn-ghost lo-btn-sm">Respond as {companyName}</button>}</div>}</div>)}
      </Card>
      <Muted>{r.methodology}</Muted>
      {err && <ErrorNote>{err}</ErrorNote>}
    </div>
  );
}
