"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Share2, Mic, Bell, BellOff, Flag, Radio, Trash2, ChevronLeft, Plus, ShieldAlert, Paperclip, Building2 } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { useDialog } from "@/components/Dialog";
import { OUTCOMES, EVIDENCE_LEVELS, EVIDENCE_KINDS } from "@/lib/stories/constants";
import { Badge, Chip, MeTooBar, ToldVsActual } from "@/components/stories/StoryBits";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";
import ShareSheet from "@/components/stories/ShareSheet";

const dot = { kind_incident: C.flag, kind_posted: C.mustard, kind_update: C.corpblue, kind_correction: C.mustard, kind_milestone: C.green, kind_response: C.corpblue };

function StoryPage({ id, initial }) {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const dialog = useDialog();
  const [s, setS] = useState(initial || null);
  const [err, setErr] = useState(null);
  const [upd, setUpd] = useState({ kind: "update", body: "", eventOn: "" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [following, setFollowing] = useState(false);
  const [report, setReport] = useState(null);
  const [ev, setEv] = useState({ kind: "email", label: "", busy: false });
  const [flash, setFlash] = useState(params.get("posted") ? "Your story is live. Thank you for sharing it." : null);

  const load = useCallback(() => api.getStory(id).then((x) => { setS(x); setFollowing(x.following); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="lo-card"><EmptyState icon={ShieldAlert} title="We couldn't find that story" tone="error">{err}</EmptyState></div>;
  if (!s) return <Loading variant="cards" />;

  async function post() {
    setBusy(true); setErr(null);
    try { setS(await api.addStoryUpdate(id, { ...upd, eventOn: upd.eventOn || undefined })); setUpd({ kind: "update", body: "", eventOn: "" }); setAdding(false); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function outcome(o) { try { setS(await api.setStoryOutcome(id, o)); } catch (e) { setErr(e.message); } }
  async function del() {
    const ok = await dialog.confirm({ title: "Delete this story?", message: "It will be removed along with its updates and evidence. This can't be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try { await api.deleteStory(id); router.push("/my-stories"); } catch (e) { setErr(e.message); }
  }
  async function track() { try { const r = await api.followStory(id); setFollowing(r.following); } catch (e) { setErr(e.message); } }
  async function sendReport() {
    try { await api.disputeStory(id, report); setReport(null); setFlash("Thanks. We'll review this story."); } catch (e) { setErr(e.message); }
  }
  async function toPulse() {
    const fd = new FormData();
    fd.set("text", `${s.title || s.formatLabel}${s.company ? ` · ${s.company}` : ""}\n${typeof window !== "undefined" ? window.location.origin : ""}/stories/${id}`);
    fd.set("type", "rant"); fd.set("mood", "Chaotic Neutral"); fd.set("mode", s.mode || "alias"); fd.set("tags", JSON.stringify(["story"]));
    try { await api.createPost(fd); router.push("/pulse"); } catch (e) { setErr(e.message); }
  }

  const level = EVIDENCE_LEVELS[s.evidenceLevel];
  const own = s.isOwner;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/" className="inline-flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 13.5 }}><ChevronLeft size={15} /> Stories</Link>
      {flash && <div style={{ background: alpha(C.green, 12), border: `1px solid ${alpha(C.green, 35)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14, color: C.text }}>{flash}</div>}
      {s.status !== "published" && <div style={{ background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>{s.status === "draft" ? "This is a private draft. Only you can see it." : `Scheduled to publish ${new Date(s.publishAt).toLocaleString()}. Only you can see it until then.`}</div>}

      <article className="lo-card flex flex-col gap-4" style={{ padding: 20 }}>
        <div className="flex items-center gap-2 flex-wrap" style={{ ...monoFont, fontSize: 13, color: C.muted }}>
          <span style={{ color: C.mustard, fontWeight: 700 }}>{s.formatLabel}</span>
          {s.company && <>· {s.companyId ? <Link href={`/companies/${s.companyId}`} style={{ color: C.text2, fontWeight: 650, textDecoration: "none" }}>{s.company}</Link> : <b style={{ color: C.text2 }}>{s.company}</b>}</>}
          {s.industry && <>· {s.industry}</>}<>· {s.author} · {s.time}</>
        </div>
        {s.title && <h1 style={{ margin: 0, fontSize: 25, fontWeight: 760, lineHeight: 1.25, letterSpacing: "-0.02em", color: C.text }}>{s.title}</h1>}
        {s.categories.length > 0 && <div className="flex gap-1.5 flex-wrap">{s.categories.map((c) => <Chip key={c} href={`/?category=${encodeURIComponent(c)}`}>{c}</Chip>)}</div>}

        <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 13.5, color: C.text2 }}>
          {[["Who", s.who && ({ current: "Current employee", former: "Former employee", applicant: "Applicant", customer: "Customer" }[s.who])], ["When", s.period || s.happenedOn], ["Role", s.roleTitle], ["Department", s.department], ["Tenure", s.tenure], ["Location", s.location]].filter(([, v]) => v).map(([k, v]) => <span key={k}><span style={{ color: C.muted }}>{k}:</span> {v}</span>)}
        </div>

        <ToldVsActual told={s.told} actual={s.actual} />
        <div style={{ fontSize: 16, lineHeight: 1.7, color: C.text, whiteSpace: "pre-wrap" }}>{s.body}</div>
        {s.impact && <div><div className="lo-eyebrow" style={{ marginBottom: 4 }}>How it affected them</div><div style={{ fontSize: 15, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap" }}>{s.impact}</div></div>}

        <FormatDetails s={s} />

        {s.noAdvice && <div style={{ fontSize: 13.5, color: C.muted, background: C.surface2, borderRadius: 10, padding: "8px 12px" }}>This person is sharing, not requesting solutions. No advice, please.</div>}
        {s.wants.length > 0 && !s.noAdvice && <div style={{ fontSize: 13.5, color: C.muted }}>They'd like: {s.wants.map((w) => ({ sharing: "to be heard", support: "support", advice: "advice", warn: "to warn others", find_others: "to find others who experienced this", accountability: "accountability", learn: "others to learn from this" }[w])).join(", ")}.</div>}

        <div className="flex flex-col gap-2" style={{ background: C.surface2, borderRadius: 12, padding: 12 }}>
          <div className="flex gap-1.5 flex-wrap">{s.badges.map((b) => <Badge key={b.key} badge={b} />)}</div>
          <div style={{ fontSize: 13, color: C.muted }}><b style={{ color: C.text2 }}>{level.label}.</b> {level.blurb} LinkedOut preserves first-hand accounts and is precise about what it knows. It does not verify that any story is true.</div>
        </div>

        {s.pattern && <div style={{ background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{s.pattern.text}</div>
          <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{s.pattern.note}</div>
        </div>}

        <MeTooBar story={s} />
      </article>

      {own && s.redactions && Object.keys(s.redactions).length > 0 && <div style={{ fontSize: 13, color: C.muted }}><ShieldAlert size={13} style={{ display: "inline", marginRight: 6 }} />We removed {Object.entries(s.redactions).map(([k, n]) => `${n} ${k}`).join(", ")} from your story before publishing.</div>}
      {own && s.identity?.message && <div style={{ fontSize: 13.5, background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: "10px 14px", color: C.text }}>{s.identity.message}</div>}

      <section className="flex flex-wrap gap-2 items-center">
        {user && !own && <button onClick={track} className="lo-btn lo-btn-secondary lo-btn-sm">{following ? <><BellOff size={14} /> Stop tracking</> : <><Bell size={14} /> Track this story</>}</button>}
        {own && s.status === "published" && <button onClick={async () => { try { await api.createRoom({ topic: s.title || s.formatLabel, mode: s.mode || "alias", storyId: id }); router.push("/vent"); } catch (e) { setErr(e.code === "TIER_RESTRICTED" ? "Hosting a Story Room is part of OUT PRO." : e.message); } }} className="lo-btn lo-btn-secondary lo-btn-sm"><Mic size={14} /> Host a Story Room</button>}
        {own && <button onClick={toPulse} className="lo-btn lo-btn-secondary lo-btn-sm"><Radio size={14} /> Discuss on Pulse</button>}
        {s.status === "published" && <button onClick={() => setShare(true)} className="lo-btn lo-btn-secondary lo-btn-sm"><Share2 size={14} /> Share</button>}
        <button onClick={() => setReport({ role: "mentioned", reason: "", details: "" })} className="lo-btn lo-btn-ghost lo-btn-sm" style={{ marginLeft: "auto" }}><Flag size={14} /> Report or contest</button>
        {own && <button onClick={del} className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }}><Trash2 size={14} /> Delete</button>}
      </section>

      {s.rooms?.length > 0 && <div className="lo-card flex items-center gap-3 flex-wrap" style={{ padding: 14, borderColor: alpha(C.mustard, 45) }}><Mic size={18} color={C.mustard} /><div style={{ flex: 1, fontSize: 14.5, color: C.text }}><b>Live now:</b> {s.rooms[0].topic}</div><Link href="/vent" className="lo-btn lo-btn-primary lo-btn-sm" style={{ textDecoration: "none" }}>Join the room</Link></div>}
      {share && <ShareSheet story={s} id={id} onClose={() => setShare(false)} />}
      {report && (
        <div className="lo-card flex flex-col gap-2" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, color: C.text }}>Ask for this story to be reviewed</div>
          <Select value={report.role} onChange={(e) => setReport({ ...report, role: e.target.value })} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14 }}>
            <option value="mentioned">I'm mentioned in it</option><option value="company">I represent the company</option><option value="other">Something else</option>
          </Select>
          <input value={report.reason} onChange={(e) => setReport({ ...report, reason: e.target.value })} placeholder="What's wrong, in a sentence" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14 }} />
          <textarea rows={3} value={report.details} onChange={(e) => setReport({ ...report, details: e.target.value })} placeholder="More detail (optional). Content that identifies a private person, shares private information or makes unsupported accusations can be removed." style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14 }} />
          <div className="flex gap-2"><button className="lo-btn lo-btn-primary lo-btn-sm" onClick={sendReport}>Send</button><button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => setReport(null)}>Cancel</button></div>
        </div>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}

      {s.responses.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>Company response</h2>
          {s.responses.map((r) => (
            <div key={r.id} className="lo-card" style={{ padding: 14, borderColor: alpha(C.corpblue, 40) }}>
              <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12.5, color: C.muted }}><Building2 size={13} /> <b style={{ color: C.text2 }}>{r.companyName}</b> · verified company representative · {r.time}</div>
              <p style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap" }}>{r.body}</p>
            </div>
          ))}
        </section>
      )}

      <section id="updates" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>What happened next?</h2>
          {own && <div className="flex items-center gap-2 flex-wrap">
            <Select aria-label="Outcome" value={s.outcome} onChange={(e) => outcome(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "6px 10px", fontSize: 13 }}>{OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</Select>
            <button onClick={() => setAdding((a) => !a)} className="lo-btn lo-btn-secondary lo-btn-sm"><Plus size={14} /> Add an update</button>
          </div>}
        </div>
        <div style={{ fontSize: 13.5, color: C.muted }}>Status: <b style={{ color: C.text2 }}>{OUTCOMES.find((o) => o.key === s.outcome)?.label}</b></div>
        {adding && (
          <div className="lo-card flex flex-col gap-2" style={{ padding: 14 }}>
            <div className="flex gap-1.5 flex-wrap">{[["update", "Update"], ["milestone", "Milestone"], ["correction", "Correction"]].map(([k, l]) => <Chip key={k} active={upd.kind === k} onClick={() => setUpd({ ...upd, kind: k })}>{l}</Chip>)}</div>
            <textarea rows={3} value={upd.body} onChange={(e) => setUpd({ ...upd, body: e.target.value })} placeholder={upd.kind === "correction" ? "I originally said X, but I later learned Y." : "I filed the complaint. I received my severance. I found another job."} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 10, fontSize: 14.5 }} />
            <input type="date" value={upd.eventOn} onChange={(e) => setUpd({ ...upd, eventOn: e.target.value })} aria-label="Date it happened" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 8, width: 190 }} />
            <div><button disabled={busy} onClick={post} className="lo-btn lo-btn-primary lo-btn-sm">Post update</button></div>
          </div>
        )}
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }} className="flex flex-col">
          {s.timeline.map((t, i) => (
            <li key={i} className="flex gap-3" style={{ paddingBottom: 14 }}>
              <div className="flex flex-col items-center"><span style={{ width: 10, height: 10, borderRadius: 99, background: dot["kind_" + t.kind] || C.muted, marginTop: 6 }} />{i < s.timeline.length - 1 && <span style={{ width: 2, flex: 1, background: C.line, marginTop: 4 }} />}</div>
              <div><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{t.label}{t.kind === "correction" ? " · correction" : ""}</div><div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.text}</div></div>
            </li>
          ))}
        </ol>
      </section>

      {own && (
        <section className="lo-card flex flex-col gap-2" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, color: C.text, fontSize: 15 }}>Add a receipt</div>
          <div style={{ fontSize: 12.5, color: C.muted }}>Emails, contracts, screenshots, payslips. Stored privately and never shown; readers only see “Evidence attached”. Crop out other people's details first.</div>
          <div className="flex gap-2 flex-wrap items-center">
            <Select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "8px 10px", fontSize: 13.5 }}>{EVIDENCE_KINDS.map((k) => <option key={k}>{k}</option>)}</Select>
            <input value={ev.label} onChange={(e) => setEv({ ...ev, label: e.target.value })} placeholder="Short label (no names)" maxLength={100} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "8px 10px", fontSize: 13.5, width: 210 }} />
            <input id="ev-file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" style={{ fontSize: 13 }} />
            <button disabled={ev.busy} className="lo-btn lo-btn-secondary lo-btn-sm" onClick={async () => {
              const file = document.getElementById("ev-file")?.files?.[0];
              if (!file && !ev.label.trim()) return setErr("Choose a file or add a label.");
              setEv({ ...ev, busy: true }); setErr(null);
              try { const fd = new FormData(); fd.set("kind", ev.kind); fd.set("label", ev.label); if (file) fd.set("file", file); await api.addStoryEvidence(id, fd); setEv({ kind: "email", label: "", busy: false }); document.getElementById("ev-file").value = ""; load(); setFlash("Receipt added."); }
              catch (e) { setErr(e.message); setEv((x) => ({ ...x, busy: false })); }
            }}><Paperclip size={14} /> {ev.busy ? "Uploading…" : "Add"}</button>
          </div>
        </section>
      )}
      {s.evidence.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>Evidence attached</h2>
          <div style={{ fontSize: 13, color: C.muted }}>Supporting material was provided by the author and is kept private. It has not been independently checked.</div>
          {s.evidence.map((e) => <div key={e.id} className="flex items-center gap-2" style={{ fontSize: 14, color: C.text2 }}><Paperclip size={14} /> {e.kind}{e.label ? `: ${e.label}` : ""}</div>)}
        </section>
      )}

      {s.related.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>Related stories</h2>
          {s.related.map((r) => <Link key={r.id} href={`/stories/${r.id}`} className="lo-card lo-tap" style={{ padding: 12, textDecoration: "none" }}><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{r.formatLabel}{r.company ? ` · ${r.company}` : ""} · {r.time}{r.sameCompany ? " · same company" : ""}</div><div style={{ fontSize: 14.5, color: C.text, marginTop: 2 }}>{r.title || r.excerpt}</div></Link>)}
        </section>
      )}
    </div>
  );
}

// Format-specific structured fields, shown as plain facts.
function FormatDetails({ s }) {
  const d = s.details || {}; const rows = [];
  if (s.format === "laid_off") rows.push(["Reason given", d.reasonGiven], ["Severance", d.severance], ["Notice", d.notice], ["Circumstances", d.circumstances], ["Lessons", d.lessons], ["Looking for next", d.next]);
  if (s.format === "interview") rows.push(["Rounds", d.rounds], ["Weeks", d.weeks], ["Outcome", d.outcome], ["Questions", d.questions], ["Recruiter", d.recruiter], ["Salary talk", d.salaryTalk]);
  if (s.format === "ghosted") rows.push(["Got as far as", d.stage], ["Rounds completed", d.rounds], ["Weeks of silence", d.silenceWeeks]);
  if (s.format === "red_flag" || s.format === "green_flag") rows.push([s.format === "red_flag" ? "🚩 Red flag" : "💚 Green flag", d.flag]);
  if (s.format === "not_in_jd") rows.push(["Not mentioned", (d.missing || []).join(", ")]);
  const out = rows.filter(([, v]) => v !== undefined && v !== "" && v !== null);
  return (
    <>
      {s.format === "salary" && d.advertised > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[["Advertised", d.advertised], ["Offered", d.offered], ["Final", d.final]].map(([l, v]) => <div key={l} style={{ background: "var(--lo-sunken)", border: `1px solid ${C.line}`, borderRadius: 12, padding: 10, textAlign: "center" }}><div className="lo-eyebrow">{l}</div><div style={{ fontSize: 18, fontWeight: 740, color: C.text }}>{v ? `${d.currency || ""} ${Number(v).toLocaleString()}` : "—"}</div></div>)}
        </div>
      )}
      {s.format === "jd_reality" && (d.posting || d.reality) && <ToldVsActual told={d.posting} actual={d.reality} label={["Job description", "Actual experience"]} />}
      {out.length > 0 && <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 14.5 }}>{out.map(([k, v]) => <><dt key={k} style={{ color: C.muted }}>{k}</dt><dd key={k + "v"} style={{ margin: 0, color: C.text, whiteSpace: "pre-wrap" }}>{String(v)}</dd></>)}</dl>}
    </>
  );
}

export default function StoryView({ id, initial }) { return <Suspense fallback={<Loading variant="cards" />}><StoryPage id={id} initial={initial} /></Suspense>; }
