"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSubmitLock } from "@/lib/useSubmitLock";
import { missingForStep } from "@/lib/stories/step-rules";
import { ShieldAlert, Sparkles, Paperclip, EyeOff, User, UserRound, Lock, Check, X, ArrowLeft, ArrowRight, Users, FileText, Scale } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { storyRisk, STORY_CATEGORIES, STORY_FORMATS, WHO_OPTIONS, WANT_OPTIONS, LEAVE_REASONS, GHOST_STAGES, EVIDENCE_KINDS } from "@/lib/stories/constants";
import { Chip } from "@/components/stories/StoryBits";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";
import Select from "@/components/ui/Select";

const STEPS = ["Type", "Basics", "Details", "Your story", "Privacy"];
const FORMAT_ICON = { experience: "📝", laid_off: "📦", quit: "🚪", fired: "🔥", interview: "🎤", ghosted: "👻", salary: "💰", management: "🧭", red_flag: "🚩", green_flag: "💚", whistleblower: "📣", confession: "🤫", warning: "⚠️", only_one: "🙋", jd_reality: "📄", not_in_jd: "🕳️" };
const Field = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1.5">
    <span style={{ fontSize: 14, fontWeight: 650, color: C.text }}>{label}</span>
    {hint && <span style={{ fontSize: 12.5, color: C.muted }}>{hint}</span>}
    {children}
  </label>
);
const inputStyle = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 12, padding: "12px 14px", fontSize: 15, width: "100%", fontFamily: "inherit", outline: "none" };
const Input = (p) => <input {...p} style={{ ...inputStyle, ...p.style }} />;
const Area = ({ rows = 5, ...p }) => <textarea rows={rows} {...p} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55, ...p.style }} />;

function Composer() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [format, setFormat] = useState(params.get("format") || "experience");
  const fmt = STORY_FORMATS.find((f) => f.key === format) || STORY_FORMATS[0];
  const [f, setF] = useState({ who: "former", companyName: params.get("company") || "", industry: "", department: "", roleTitle: "", tenure: "", location: "", period: "", happenedOn: "", title: "", body: "", told: "", actual: "", impact: "" });
  const [details, setDetails] = useState({});
  const [categories, setCategories] = useState(params.get("format") === "laid_off" ? ["Laid off"] : []);
  const [wants, setWants] = useState(["sharing"]);
  const [leave, setLeave] = useState([]);
  const [noAdvice, setNoAdvice] = useState(false);
  const [mode, setMode] = useState("anon");
  const [publishAt, setPublishAt] = useState("");
  const [files, setFiles] = useState([]);
  const [risk, setRisk] = useState(null);
  const [assist, setAssist] = useState(null);
  const [suggest, setSuggest] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const { busy, run: runLocked } = useSubmitLock();
  const draftId = params.get("draft");
  const [draftLoading, setDraftLoading] = useState(!!draftId);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [step, setStep] = useState(params.get("format") ? 1 : 0);
  const [noindex, setNoindex] = useState(false);
  const [modeTouched, setModeTouched] = useState(false);
  const [circle, setCircle] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const setD = (k) => (e) => setDetails((s) => ({ ...s, [k]: e.target.value }));
  const toggle = (arr, setArr, v, max = 99) => setArr(arr.includes(v) ? arr.filter((x) => x !== v) : arr.length >= max ? arr : [...arr, v]);

  // Draft restore, so a long story is never lost to a closed tab.
  useEffect(() => { try { const d = JSON.parse(sessionStorage.getItem("lo-story-draft") || "null"); if (d?.f && !params.get("format") && !params.get("draft")) { setF(d.f); setDetails(d.details || {}); setFormat(d.format || "experience"); setCategories(d.categories || []); } } catch {} }, []); // eslint-disable-line
  useEffect(() => { const t = setTimeout(() => { try { if (!draftId) sessionStorage.setItem("lo-story-draft", JSON.stringify({ f, details, format, categories })); } catch {} }, 600); return () => clearTimeout(t); }, [f, details, format, categories]);

  // Reopen a saved server-side draft: /stories/new?draft=<id>
  useEffect(() => {
    if (!draftId || !user) return;
    let alive = true;
    api.getStory(draftId).then((s) => {
      if (!alive) return;
      if (s.status === "published") { router.replace(`/stories/${s.id}`); return; }
      setFormat(s.format || "experience");
      setF({ who: s.who || "former", companyName: s.company || "", industry: s.industry || "", department: s.department || "", roleTitle: s.roleTitle || "", tenure: s.tenure || "", location: s.location || "", period: s.period || "", happenedOn: s.happenedOn || "", title: s.title || "", body: s.body || "", told: s.told || "", actual: s.actual || "", impact: s.impact || "" });
      setDetails(s.details || {}); setCategories(s.categories || []); setWants(s.wants?.length ? s.wants : ["sharing"]); setLeave(s.leaveReasons || []);
      setNoAdvice(!!s.noAdvice); if (s.mode) { setMode(s.mode); setModeTouched(true); } setNoindex(!!s.noindex);
      if (s.publishAt) { const d = new Date(s.publishAt); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); setPublishAt(d.toISOString().slice(0, 16)); }
      setStep(1); setDraftLoading(false);
    }).catch((e) => { if (alive) { setError(e.message || "We couldn't open that draft."); setDraftLoading(false); } });
    return () => { alive = false; };
  }, [draftId, user]); // eslint-disable-line

  useEffect(() => { const c = params.get("circle"); if (c) api.getCircle(c).then(setCircle).catch(() => {}); }, [params]);

  // Bring a Pulse post across: /stories/new?from=<postId>
  useEffect(() => {
    const from = params.get("from");
    if (!from) return;
    fetch(`/api/posts/${from}`).then((r) => r.json()).then((p) => { if (p?.text) setF((s) => ({ ...s, body: p.text, title: p.title || s.title })); }).catch(() => {});
  }, [params]);

  // Company autocomplete — links the Story to the company page when it exists.
  useEffect(() => {
    setCompanyId(null);
    const t = f.companyName.trim();
    if (t.length < 3) { setSuggest([]); return; }
    const h = setTimeout(() => { fetch(`/api/companies?q=${encodeURIComponent(t)}`).then((r) => r.json()).then((rows) => setSuggest((Array.isArray(rows) ? rows : rows.companies || []).filter((c) => c.name?.toLowerCase().includes(t.toLowerCase())).slice(0, 5))).catch(() => setSuggest([])); }, 250);
    return () => clearTimeout(h);
  }, [f.companyName]);

  // Pre-publish identity-risk + redaction preview (debounced).
  useEffect(() => {
    if (!user || f.body.length < 30) { setRisk(null); return; }
    const h = setTimeout(() => { api.checkStoryRisk({ told: f.told, actual: f.actual, mode, company: f.companyName, department: f.department, location: f.location, roleTitle: f.roleTitle, tenure: f.tenure, period: f.period, text: f.body, body: f.body }).then(setRisk).catch(() => {}); }, 700);
    return () => clearTimeout(h);
  }, [user, mode, f.companyName, f.department, f.location, f.roleTitle, f.tenure, f.period, f.body]);

  const redactNote = useMemo(() => {
    const n = risk?.redactions || {}; const parts = Object.entries(n).map(([k, v]) => `${v} ${k}`);
    return parts.length ? `We'll remove ${parts.join(", ")} before publishing.` : null;
  }, [risk]);

  async function askAssist() {
    setAssist(null); setError(null);
    try { setAssist(await api.assistStory(f.body)); } catch (e) { setError(e.message); }
  }

  async function swapNamesNow() {
    try { const r = await api.checkStoryRisk({ body: f.body, told: f.told, actual: f.actual, company: f.companyName, swap: true }); if (r.swapped) setF((x) => ({ ...x, body: r.swapped })); } catch (e) { setError(e.message); }
  }
  function submit(asDraft = false) {
    return runLocked(() => doSubmit(asDraft), { keepLocked: true }).catch(() => {});
  }
  async function doSubmit(asDraft) {
    setError(null);
    if (!asDraft) {
      for (const n of [1, 2, 3]) { const m = missingForStep(n, { format, layout, f, details }); if (m.length) { setStep(n); setError(`Before you publish: ${m.map((x) => x.label).join(", ")}.`); throw new Error("incomplete"); } }
    }
    try {
      const payload = {
        format, who: f.who, companyId, ...f, categories, wants, leaveReasons: leave, noAdvice, mode,
        details: { ...details }, status: asDraft ? "draft" : undefined, publishAt: publishAt ? new Date(publishAt).toISOString() : undefined, circleSlug: params.get("circle") || undefined, noindex, sourcePostId: params.get("from") || undefined,
      };
      const out = draftId ? await api.updateStory(draftId, payload) : await api.createStory(payload);
      for (const file of files) {
        const fd = new FormData(); fd.set("kind", file.kind); fd.set("label", file.label); if (file.file) fd.set("file", file.file);
        await api.addStoryEvidence(out.story.id, fd).catch((e) => setNotice(`Story saved. One attachment didn't upload: ${e.message}`));
      }
      try { sessionStorage.removeItem("lo-story-draft"); } catch {}
      router.push(asDraft ? "/my-stories" : `/stories/${out.story.id}?posted=1`);
    } catch (e) { setError(e.message); throw e; }
  }

  if (loading || draftLoading) return <Loading variant="cards" />;
  if (!user) return <div className="lo-card" style={{ padding: 24 }}><div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Log in to tell your story</div><p style={{ color: C.muted, fontSize: 14.5 }}>You can post under your name, an alias, or fully anonymously. Reading is always open.</p><Link href="/login" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Log in</Link></div>;

  const tier = storyRisk(format, categories);
  // Higher-risk stories start anonymous (until the person makes their own choice) and can't be search-indexed.
  useEffect(() => { if (!modeTouched && tier.defaultMode) setMode(tier.defaultMode); }, [tier.defaultMode, modeTouched]);
  const layout = fmt.layout;
  const miss = missingForStep(step, { format, layout, f, details });
  return (
    <div className="flex flex-col gap-5">
      {circle && <div className="lo-card flex items-center gap-2" style={{ padding: "10px 14px", borderColor: alpha(C.corpblue, 40) }}><Users size={16} color={C.corpblue} /><span style={{ fontSize: 14, color: C.text }}>Sharing in <b>{circle.name}</b>. Members of the circle will see this.</span></div>}
      <header>
        <div className="lo-eyebrow" style={{ color: C.mustard }}>Tell us what happened</div>
        <h1 style={{ margin: "4px 0 0", fontSize: 27, fontWeight: 780, letterSpacing: "-0.025em", color: C.text }}>{step === 0 ? "What kind of story is it?" : fmt.label}</h1>
        {step > 0 && <p style={{ margin: "6px 0 0", color: C.muted, fontSize: 14.5 }}>{fmt.hint}</p>}
      </header>
      <nav aria-label="Progress" className="flex items-center gap-2">
        {STEPS.map((t, i) => (
          <button key={t} type="button" onClick={() => i <= step && setStep(i)} aria-current={i === step ? "step" : undefined} disabled={i > step}
            className="flex items-center gap-2" style={{ background: "none", border: "none", cursor: i <= step ? "pointer" : "default", padding: 0, flex: i === STEPS.length - 1 ? "0 0 auto" : 1 }}>
            <span style={{ width: 26, height: 26, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: i <= step ? C.mustard : C.surface2, color: i <= step ? "#fff" : C.muted, border: `1px solid ${i <= step ? C.mustard : C.line}` }}>{i < step ? <Check size={14} /> : i + 1}</span>
            <span className="hidden sm:inline" style={{ ...monoFont, fontSize: 12, color: i === step ? C.text : C.muted, fontWeight: i === step ? 700 : 500 }}>{t}</span>
            {i < STEPS.length - 1 && <span style={{ flex: 1, height: 2, background: i < step ? C.mustard : C.line, borderRadius: 2, minWidth: 8 }} />}
          </button>
        ))}
      </nav>

      <div className="grid gap-5" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div className="flex flex-col gap-5">
      {step === 0 && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }} role="radiogroup" aria-label="Story format">
          {STORY_FORMATS.map((x) => (
            <button key={x.key} type="button" role="radio" aria-checked={x.key === format} onClick={() => { setFormat(x.key); setStep(1); }} className="lo-card lo-tap text-left flex flex-col gap-1"
              style={{ padding: 14, cursor: "pointer", borderColor: x.key === format ? C.mustard : undefined, boxShadow: x.key === format ? `0 0 0 2px ${alpha(C.mustard, 30)}` : undefined }}>
              <span style={{ fontSize: 22 }}>{FORMAT_ICON[x.key]}</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: C.text }}>{x.label}</span>
              <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.4 }}>{x.hint}</span>
            </button>
          ))}
        </div>
      )}
      {step === 1 && (<>
      <section className="lo-card flex flex-col gap-4" style={{ padding: 18 }}>
        <Field label="Who are you in this story?">
          <div className="flex gap-1.5 flex-wrap">{WHO_OPTIONS.map((o) => <Chip key={o.key} active={f.who === o.key} onClick={() => setF((s) => ({ ...s, who: o.key }))}>{o.label}</Chip>)}</div>
        </Field>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <Field label="Where did it happen?" hint="Company name, or leave blank and add an industry.">
            <div style={{ position: "relative" }}>
              <Input value={f.companyName} onChange={set("companyName")} placeholder="Company" maxLength={120} />
              {suggest.length > 0 && !companyId && (
                <div style={{ position: "absolute", zIndex: 5, left: 0, right: 0, top: "calc(100% + 4px)", background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 10, boxShadow: "var(--lo-shadow-2)" }}>
                  {suggest.map((c) => <button type="button" key={c.id} onClick={() => { setF((s) => ({ ...s, companyName: c.name, industry: s.industry || c.industry || "" })); setCompanyId(c.id); setSuggest([]); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", color: C.text, fontSize: 14, cursor: "pointer" }}>{c.name}{c.industry ? <span style={{ color: C.muted }}> · {c.industry}</span> : null}</button>)}
                </div>
              )}
            </div>
          </Field>
          <Field label="Industry"><Input value={f.industry} onChange={set("industry")} placeholder="e.g. Fintech" maxLength={80} /></Field>
          <Field label="When?" hint="An approximate period is fine."><Input value={f.period} onChange={set("period")} placeholder="e.g. March 2026" maxLength={60} /></Field>
          <Field label="Exact date (optional)" hint="Helps timelines and patterns."><Input type="date" value={f.happenedOn} onChange={set("happenedOn")} /></Field>
        </div>
      </section>

      </>)}
      {step === 2 && (<>
      {layout === "layoff" && (
        <section className="lo-card flex flex-col gap-3" style={{ padding: 18 }}>
          <div><div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>I was laid off today.</div><p style={{ margin: "4px 0 0", fontSize: 14, color: C.muted }}>You can publish just that. Everything below is optional, and you can add details later.</p></div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Department"><Input value={f.department} onChange={set("department")} placeholder="e.g. Engineering" maxLength={120} /></Field>
            <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} maxLength={120} /></Field>
            <Field label="Tenure"><Input value={f.tenure} onChange={set("tenure")} placeholder="e.g. 3 years" maxLength={60} /></Field>
            <Field label="Location"><Input value={f.location} onChange={set("location")} placeholder="City or Remote" maxLength={120} /></Field>
            <Field label="Reason given"><Input value={details.reasonGiven || ""} onChange={setD("reasonGiven")} placeholder="What were you told?" /></Field>
            <Field label="Severance"><Input value={details.severance || ""} onChange={setD("severance")} placeholder="e.g. 3 months" /></Field>
            <Field label="Notice period"><Input value={details.notice || ""} onChange={setD("notice")} placeholder="e.g. none / 30 days" /></Field>
            <Field label="How many were affected?" hint="Your best estimate of the whole company."><Input type="number" min="1" value={details.companyWide || ""} onChange={(e) => setDetails((s) => ({ ...s, companyWide: e.target.value ? Number(e.target.value) : "" }))} /></Field>
          </div>
          <Field label="Circumstances"><Area rows={3} value={details.circumstances || ""} onChange={setD("circumstances")} placeholder="How were you told?" /></Field>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <Field label="Lessons"><Area rows={3} value={details.lessons || ""} onChange={setD("lessons")} /></Field>
            <Field label="What are you looking for next?"><Area rows={3} value={details.next || ""} onChange={setD("next")} /></Field>
          </div>
        </section>
      )}

      {layout === "interview" && (
        <section className="lo-card grid" style={{ padding: 18, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} maxLength={120} /></Field>
          <Field label="Number of rounds"><Input type="number" min="1" max="19" value={details.rounds || ""} onChange={(e) => setDetails((s) => ({ ...s, rounds: e.target.value ? Number(e.target.value) : "" }))} /></Field>
          <Field label="Total time (weeks)"><Input type="number" min="0" value={details.weeks || ""} onChange={(e) => setDetails((s) => ({ ...s, weeks: e.target.value ? Number(e.target.value) : "" }))} /></Field>
          <Field label="Outcome"><Select value={details.outcome || ""} onChange={setD("outcome")} style={inputStyle}><option value="">Choose</option><option>Offer</option><option>Rejected</option><option>Ghosted</option><option>I withdrew</option></Select></Field>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Questions they asked (optional)"><Area rows={3} value={details.questions || ""} onChange={setD("questions")} /></Field></div>
          <Field label="How did the recruiter behave?"><Area rows={2} value={details.recruiter || ""} onChange={setD("recruiter")} /></Field>
          <Field label="Salary discussion"><Area rows={2} value={details.salaryTalk || ""} onChange={setD("salaryTalk")} /></Field>
        </section>
      )}

      {layout === "ghosted" && (
        <section className="lo-card flex flex-col gap-3" style={{ padding: 18 }}>
          <Field label="How far did you get?"><div className="flex gap-1.5 flex-wrap">{GHOST_STAGES.map((s) => <Chip key={s} active={details.stage === s} onClick={() => setDetails((d) => ({ ...d, stage: s }))}>{s}</Chip>)}</div></Field>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} /></Field>
            <Field label="Rounds completed"><Input type="number" min="0" max="19" value={details.rounds || ""} onChange={(e) => setDetails((s) => ({ ...s, rounds: e.target.value ? Number(e.target.value) : "" }))} /></Field>
            <Field label="Weeks of silence"><Input type="number" min="0" value={details.silenceWeeks || ""} onChange={(e) => setDetails((s) => ({ ...s, silenceWeeks: e.target.value ? Number(e.target.value) : "" }))} /></Field>
          </div>
        </section>
      )}

      {layout === "salary" && (
        <section className="lo-card grid" style={{ padding: 18, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} /></Field>
          <Field label="Currency"><Input value={details.currency || ""} onChange={setD("currency")} placeholder="USD, KES, GBP" maxLength={6} /></Field>
          {[["advertised", "Advertised"], ["offered", "Offered"], ["final", "Final compensation"]].map(([k, l]) => (
            <Field key={k} label={l}><Input type="number" min="0" value={details[k] ?? ""} onChange={(e) => setDetails((s) => ({ ...s, [k]: e.target.value ? Number(e.target.value) : "" }))} /></Field>
          ))}
          <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: C.muted }}>Pay period (per month or per year) should match across the three numbers.</div>
        </section>
      )}

      {layout === "jd" && (
        <section className="lo-card grid" style={{ padding: 18, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} /></Field><div />
          <Field label="Job description said"><Area rows={3} value={details.posting || ""} onChange={setD("posting")} placeholder="Flexible hybrid environment." /></Field>
          <Field label="Actual experience"><Area rows={3} value={details.reality || ""} onChange={setD("reality")} placeholder="Mandatory office attendance four days per week." /></Field>
        </section>
      )}

      {layout === "notinjd" && (
        <section className="lo-card flex flex-col gap-3" style={{ padding: 18 }}>
          <Field label="Job title"><Input value={f.roleTitle} onChange={set("roleTitle")} /></Field>
          <Field label="What wasn't mentioned?" hint="One per line: weekend support, on-call, sales targets, managing interns…"><Area rows={4} value={(details.missing || []).join("\n")} onChange={(e) => setDetails((s) => ({ ...s, missing: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 12) }))} /></Field>
        </section>
      )}

      {layout === "flag" && (
        <section className="lo-card" style={{ padding: 18 }}>
          <Field label={format === "red_flag" ? "🚩 The red flag, in one line" : "💚 What they did right, in one line"} hint="e.g. “Managers expect replies after midnight” or “Paid full severance and gave 60 days’ notice”."><Input value={details.flag || ""} onChange={setD("flag")} maxLength={140} /></Field>
        </section>
      )}

      {!["layoff","interview","ghosted","salary","jd","notinjd","flag"].includes(layout) && (
        <section className="lo-card flex flex-col gap-3" style={{ padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>About your role (optional)</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <Field label="Department"><Input value={f.department} onChange={set("department")} /></Field>
            <Field label="Role"><Input value={f.roleTitle} onChange={set("roleTitle")} /></Field>
            <Field label="Tenure"><Input value={f.tenure} onChange={set("tenure")} /></Field>
            <Field label="Location"><Input value={f.location} onChange={set("location")} /></Field>
          </div>
        </section>
      )}
      </>)}
      {step === 3 && (<>
      <section className="lo-card flex flex-col gap-4" style={{ padding: 18 }}>
        <Field label="What's actually happening?" hint="Choose up to three that fit.">
          <div className="flex gap-1.5 flex-wrap">{STORY_CATEGORIES.map((c) => <Chip key={c} active={categories.includes(c)} onClick={() => toggle(categories, setCategories, c, 3)}>{c}</Chip>)}</div>
        </Field>
        <Field label="Headline (optional)"><Input value={f.title} onChange={set("title")} maxLength={140} placeholder="One line that says what happened" /></Field>
        <Field label="What happened?" hint="Describe what you experienced in your own words. Stick to what you saw and what was said.">
          <Area rows={9} value={f.body} onChange={set("body")} placeholder="Start wherever it starts…" maxLength={8000} />
        </Field>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          <Field label="What were you told? (optional)"><Area rows={3} value={f.told} onChange={set("told")} placeholder="“We're a family.”" /></Field>
          <Field label="What actually happened? (optional)"><Area rows={3} value={f.actual} onChange={set("actual")} placeholder="Laid off 60% of the team three months later." /></Field>
        </div>
        <Field label="How did it affect you? (optional)"><Area rows={3} value={f.impact} onChange={set("impact")} /></Field>
        {["quit", "fired", "laid_off", "experience", "management", "warning"].includes(format) && (
          <Field label="Why did you leave? (optional)" hint="Shown only as anonymous percentages once enough people have answered."><div className="flex gap-1.5 flex-wrap">{LEAVE_REASONS.map((r) => <Chip key={r} active={leave.includes(r)} onClick={() => toggle(leave, setLeave, r, 4)}>{r}</Chip>)}</div></Field>
        )}
      </section>

      {risk?.namedPeople?.length > 0 && (
        <div className="lo-card flex flex-col gap-2" style={{ padding: 14, borderColor: alpha(C.mustard, 45) }}>
          <div style={{ fontSize: 14, color: C.text }}><Scale size={14} style={{ display: "inline", marginRight: 6 }} /><b>You've named {risk.namedPeople.length === 1 ? "someone" : "people"}</b> ({risk.namedPeople.join(", ")}). Stories land better, and stay safer, when they describe what happened and the role, not the person.</div>
          <div><button type="button" className="lo-btn lo-btn-secondary lo-btn-sm" onClick={swapNamesNow}>Replace names with “a colleague”</button></div>
        </div>
      )}
      {assist && (
        <div className="lo-card flex flex-col gap-2" style={{ padding: 14, borderColor: alpha(C.mustard, 40) }}>
          <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}><Sparkles size={14} style={{ display: "inline", marginRight: 6 }} />Suggestions (yours to take or leave)</div>
          {assist.title && <div style={{ fontSize: 14 }}>Headline: <b>{assist.title}</b> <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setF((s) => ({ ...s, title: assist.title }))}>Use</button></div>}
          {assist.told && <div style={{ fontSize: 14 }}>Told: “{assist.told}” <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setF((s) => ({ ...s, told: assist.told }))}>Use</button></div>}
          {assist.actual && <div style={{ fontSize: 14 }}>Actual: {assist.actual} <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setF((s) => ({ ...s, actual: assist.actual }))}>Use</button></div>}
          {assist.questions?.map((q) => <div key={q} style={{ fontSize: 13.5, color: C.muted }}>Could add: {q}</div>)}
          {assist.careful?.map((q) => <div key={q} style={{ fontSize: 13.5, color: C.mustard }}>Wording: {q}</div>)}
        </div>
      )}

      </>)}
      {step === 4 && (<>
      <section className="lo-card flex flex-col gap-4" style={{ padding: 18 }}>
        <Field label="What do you want?" hint="This shapes how people respond to you.">
          <div className="flex gap-1.5 flex-wrap">{WANT_OPTIONS.map((o) => <Chip key={o.key} active={wants.includes(o.key)} onClick={() => toggle(wants, setWants, o.key)}>{o.label}</Chip>)}</div>
        </Field>
        <label className="flex items-center gap-2" style={{ fontSize: 14, color: C.text }}><input type="checkbox" checked={noAdvice} onChange={(e) => setNoAdvice(e.target.checked)} /> No advice, please. I'm sharing, not asking for solutions.</label>

        <Field label="Receipts (optional)" hint={`Emails, contracts, screenshots, payslips, messages, HR communications. Stored privately and never shown. Readers only see “Evidence attached”. Crop out other people’s details before uploading.`}>
          <div className="flex flex-col gap-2">
            {files.map((x, i) => (
              <div key={i} className="flex items-center gap-2" style={{ fontSize: 13.5 }}><Paperclip size={14} /> {x.kind}: {x.file?.name || x.label || "declared"} <button type="button" aria-label="Remove" onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={14} /></button></div>
            ))}
            <AddEvidence onAdd={(x) => setFiles((a) => [...a, x].slice(0, 8))} />
          </div>
        </Field>

        <Field label="Identity">
          <div className="flex gap-1.5 flex-wrap">
            {[["real", "Real identity", User], ["alias", "Alias", UserRound], ["anon", "Anonymous", EyeOff]].map(([k, l, Icon]) => (
              <button key={k} type="button" onClick={() => { setMode(k); setModeTouched(true); }} className="lo-btn lo-btn-sm" style={{ background: mode === k ? C.mustard : "transparent", color: mode === k ? "#fff" : C.text2, border: `1px solid ${mode === k ? C.mustard : C.line}` }}><Icon size={14} /> {l}</button>
            ))}
          </div>
        </Field>

        <div style={{ background: alpha(tier.level === "high" ? C.flag : tier.level === "elevated" ? C.mustard : C.corpblue, 10), border: `1px solid ${alpha(tier.level === "high" ? C.flag : tier.level === "elevated" ? C.mustard : C.corpblue, 35)}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 6 }}><Scale size={14} style={{ display: "inline", marginRight: 6 }} />Before you post · {tier.label}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.text2, lineHeight: 1.55 }}>{tier.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        {redactNote && <div style={{ fontSize: 13.5, color: C.text, background: alpha(C.corpblue, 10), border: `1px solid ${alpha(C.corpblue, 30)}`, borderRadius: 10, padding: "8px 12px" }}><ShieldAlert size={14} style={{ display: "inline", marginRight: 6 }} />{redactNote}</div>}
        {risk?.identityRisk?.message && (
          <div style={{ fontSize: 13.5, color: C.text, background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 10, padding: "8px 12px" }}>
            <b>Identity risk ({risk.identityRisk.level}).</b> {risk.identityRisk.message}
            {mode !== "anon" && <button type="button" className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setMode("anon")}>Post anonymously</button>}
          </div>
        )}
        {risk?.identityRiskLocked && <div style={{ fontSize: 12.5, color: C.muted }}><Lock size={12} style={{ display: "inline", marginRight: 4 }} />Identity-risk checks are part of <Link href="/premium" style={{ color: C.mustard }}>OUT+</Link>. Automatic redaction of emails, phone numbers and IDs is on for everyone.</div>}

        <label className="flex items-start gap-2" style={{ fontSize: 14, color: C.text }}><input type="checkbox" checked={noindex || tier.forceNoindex} disabled={tier.forceNoindex} onChange={(e) => setNoindex(e.target.checked)} style={{ marginTop: 3 }} /><span>Keep this story out of search engines. <span style={{ color: C.muted }}>It stays visible on LinkedOut. Stories we judge easy to identify are kept out automatically.</span></span></label>
        <Field label="Publish later (optional)" hint="OUT+ can schedule a story for up to 90 days ahead.">
          <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
        </Field>
      </section>

      </>)}
      </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {notice && <div style={{ fontSize: 13, color: C.muted }}>{notice}</div>}
      {step > 0 && step < 4 && miss.length > 0 && <div role="status" style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, border: `1px dashed ${C.line}`, borderRadius: 12, padding: "9px 12px" }}><b style={{ color: C.text }}>Still needed to continue:</b> {miss.map((x) => x.label).join(", ")}</div>}
      {step > 0 && (
        <div className="flex gap-2 flex-wrap items-center" style={{ position: "sticky", bottom: 8, zIndex: 5, background: alpha(C.surface, 92), backdropFilter: "blur(8px)", border: `1px solid ${C.line}`, borderRadius: 16, padding: 10 }}>
          <button type="button" onClick={() => setStep((x) => Math.max(0, x - 1))} className="lo-btn lo-btn-ghost"><ArrowLeft size={16} /> Back</button>
          <span style={{ flex: 1 }} />
          {step === 3 && <button disabled={busy || f.body.length < 40} onClick={askAssist} className="lo-btn lo-btn-ghost"><Sparkles size={16} /> Help me structure this</button>}
          {step < 4 ? (
            <button type="button" disabled={miss.length > 0} title={miss.length ? "Complete the required fields first" : undefined} onClick={() => setStep((x) => Math.min(4, x + 1))} className="lo-btn lo-btn-primary">Continue <ArrowRight size={16} /></button>
          ) : (<>
            <button disabled={busy} onClick={() => submit(true)} className="lo-btn lo-btn-secondary">Save private draft</button>
            <button disabled={busy} onClick={() => submit(false)} className="lo-btn lo-btn-primary">{busy ? "Publishing…" : publishAt ? "Schedule story" : "Publish story"}</button>
          </>)}
        </div>
      )}
      <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Stories are first-hand accounts. Describe what you experienced rather than what you believe others intended. Anyone mentioned can ask for a review, and companies have a right of reply. <Link href="/terms" style={{ color: C.mustard }}>Rules</Link></p>
    </div>
  );
}

function AddEvidence({ onAdd }) {
  const [kind, setKind] = useState("email"); const [label, setLabel] = useState(""); const ref = useRef(null);
  return (
    <div className="flex gap-2 flex-wrap items-center">
      <Select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, width: "auto" }}>{EVIDENCE_KINDS.map((k) => <option key={k}>{k}</option>)}</Select>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Short label (no names)" style={{ width: 200 }} maxLength={100} />
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" style={{ fontSize: 13 }} />
      <button type="button" className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => { const file = ref.current?.files?.[0] || null; if (!file && !label.trim()) return; onAdd({ kind, label, file }); setLabel(""); if (ref.current) ref.current.value = ""; }}><Check size={14} /> Add</button>
    </div>
  );
}

export default function NewStoryPage() { return <Suspense fallback={<Loading variant="cards" />}><Composer /></Suspense>; }
