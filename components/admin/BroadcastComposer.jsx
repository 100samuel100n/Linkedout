"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { Pill, Stat, card, btn, inputStyle } from "./ui";
import { Modal } from "./SectionTable";
import Select from "@/components/ui/Select";

const EMPTY_AUD = { mode: "all", plans: [], countries: "", verified: [], activeDays: "", inactiveDays: "", joinedDays: "", staffOnly: false, hasOpenTicket: false, twoFactor: "", people: "" };
const PRESETS = [
  ["Everyone", { mode: "all" }], ["Free plan", { mode: "segment", plans: ["basic"] }], ["Paying members", { mode: "segment", plans: ["plus", "pro"] }],
  ["Inactive 30+ days", { mode: "segment", inactiveDays: "30" }], ["New this week", { mode: "segment", joinedDays: "7" }], ["Verified accounts", { mode: "segment", verified: ["id"] }], ["Staff only", { mode: "segment", staffOnly: true }],
];
const label = { fontSize: 12, color: C.muted, display: "block", marginBottom: 4 };
const sect = { ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: ".08em", margin: "18px 0 8px" };

// One composer for BOTH channels. channel = "push" | "email".
export default function BroadcastComposer({ channel, title }) {
  const isPush = channel === "push", id = isPush ? "push" : "emailcast";
  const [data, setData] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [f, setF] = useState({ name: "", subject: "", title: "", body: "", preheader: "", ctaLabel: "", ctaUrl: "", kind: "marketing", inApp: true, audience: EMPTY_AUD, schedule: "now", scheduleAt: "" });
  const [media, setMedia] = useState(null), [mUp, setMUp] = useState(false), [mErr, setMErr] = useState("");
  const [reach, setReach] = useState(null), [html, setHtml] = useState(""), [confirm, setConfirm] = useState(false), [testTo, setTestTo] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const aud = f.audience, setAud = (p) => set("audience", { ...aud, ...p });

  const load = useCallback(() => adminApi.get(id).then(setData).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!data?.history.some((h) => ["sending", "scheduled"].includes(h.status))) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [data, load]);

  const payload = useMemo(() => ({ ...f, media: isPush ? media : null, audience: { ...aud, countries: String(aud.countries || "").split(/[,\s]+/).filter(Boolean) }, scheduleAt: f.schedule === "later" && f.scheduleAt ? new Date(f.scheduleAt).toISOString() : null }), [f, aud, media, isPush]);
  useEffect(() => { // live reach
    const t = setTimeout(() => adminApi.post(`${id}/preview`, { audience: payload.audience, kind: f.kind }).then(setReach).catch(() => setReach(null)), 350);
    return () => clearTimeout(t);
  }, [payload.audience, f.kind, id]);
  useEffect(() => { // live email preview
    if (isPush) return;
    const t = setTimeout(() => adminApi.post(`${id}/render`, { title: f.title, body: f.body, ctaLabel: f.ctaLabel, ctaUrl: f.ctaUrl, preheader: f.preheader, kind: f.kind }).then((r) => setHtml(r.html)).catch(() => {}), 450);
    return () => clearTimeout(t);
  }, [f.title, f.body, f.ctaLabel, f.ctaUrl, f.preheader, f.kind, isPush, id]);

  const run = async (fn) => { setBusy(true); setErr(""); setNotice(""); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const send = () => run(async () => { const r = await adminApi.post(`${id}/send`, payload); setConfirm(false); setNotice(r.immediate ? `Sending to ${r.reachable.toLocaleString()} ${isPush ? "devices' owners" : "people"} now — progress appears in the history below.` : `Scheduled for ${new Date(r.scheduledAt).toLocaleString()}.`); setF((x) => ({ ...x, name: "", subject: "", title: "", body: "", preheader: "", ctaLabel: "", ctaUrl: "" })); setMedia(null); await load(); });
  const test = () => run(async () => { const r = await adminApi.post(`${id}/test`, { ...payload, to: testTo }); setNotice(isPush ? `Test push sent to ${r.devices} of your device(s).` : `Test email sent to ${r.sentTo}.`); });
  const cancel = (bid) => run(async () => { await adminApi.post(`${id}/${bid}/cancel`, {}); await load(); });
  const reuse = (h) => { const r = h.raw; setMedia(r.media || null); setF({ name: r.name || "", subject: r.subject || "", title: r.title || "", body: r.body || "", preheader: "", ctaLabel: r.ctaLabel || "", ctaUrl: r.ctaUrl || "", kind: r.kind, inApp: r.inApp, audience: { ...EMPTY_AUD, ...r.audience, countries: (r.audience.countries || []).join(", ") }, schedule: "now", scheduleAt: "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const ready = isPush ? f.title.trim() && f.body.trim() : f.subject.trim() && f.body.trim();
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const check = (txt, on, fn) => <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={on} onChange={fn} />{txt}</label>;
  const num = (k, txt) => <label style={{ fontSize: 12, color: C.muted }}>{txt}<input type="number" min="1" value={aud[k]} onChange={(e) => setAud({ [k]: e.target.value })} style={{ ...inputStyle, marginTop: 4 }} /></label>;
  const stateColor = (s) => (s === "sent" ? C.green : s === "failed" || s === "cancelled" ? C.flag : C.mustard);

  if (!data) return err ? <ErrorNote>{err}</ErrorNote> : <Loading />;
  return (
    <div>
      <h1 style={{ ...displayFont, fontSize: 24, margin: "0 0 12px" }}>{title}</h1>
      <div style={{ ...card, marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "6px 20px" }}>
        {data.status.items.map(([k, v, ok]) => <div key={k} style={{ fontSize: 12.5 }}><span style={{ color: ok ? C.green : C.mustard }}>●</span> <span style={{ color: C.muted }}>{k}:</span> {v}</div>)}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {notice && <p style={{ color: C.green, fontSize: 13 }}>{notice}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
        {/* ---------------- compose ---------------- */}
        <div style={card}>
          <div style={{ ...sect, marginTop: 0 }}>Message</div>
          <label style={label}>Internal name (only you see this)<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={isPush ? "e.g. October feature drop" : "e.g. Pro launch announcement"} style={inputStyle} /></label>
          {!isPush && <label style={{ ...label, marginTop: 10 }}>Subject line<input value={f.subject} onChange={(e) => set("subject", e.target.value)} maxLength={150} placeholder="Hi {{firstName}}, something new is live" style={inputStyle} /></label>}
          {!isPush && <label style={{ ...label, marginTop: 10 }}>Preview text (shown next to the subject in the inbox)<input value={f.preheader} onChange={(e) => set("preheader", e.target.value)} maxLength={140} style={inputStyle} /></label>}
          <label style={{ ...label, marginTop: 10 }}>{isPush ? "Title" : "Headline inside the email"}{isPush ? ` (${f.title.length}/65)` : ""}<input value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={isPush ? 65 : 120} style={inputStyle} /></label>
          <label style={{ ...label, marginTop: 10 }}>{isPush ? `Message (${f.body.length}/178)` : "Body"}
            <textarea rows={isPush ? 3 : 10} value={f.body} onChange={(e) => set("body", e.target.value)} maxLength={isPush ? 178 : 20000} style={inputStyle} />
          </label>
          {isPush && (
            <div style={{ marginTop: 12, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ ...label, marginBottom: 6 }}>Audio (optional): voice note, clip or song</div>
              {!media ? (
                <label style={{ ...btn(), display: "inline-block", cursor: mUp ? "wait" : "pointer" }}>
                  {mUp ? "Uploading…" : "Attach audio"}
                  <input type="file" accept="audio/*" hidden disabled={mUp} onChange={async (e) => {
                    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
                    setMErr(""); setMUp(true);
                    try {
                      const dur = await new Promise((res) => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => res(Math.round(a.duration) || 0); a.onerror = () => res(0); a.src = URL.createObjectURL(file); });
                      const fd = new FormData(); fd.append("file", file);
                      const r = await fetch("/api/admin/broadcast-audio", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
                      if (!r.ok) throw new Error(j.error || "Upload failed.");
                      setMedia({ url: j.url, bytes: j.bytes, mime: j.mime, dur, kind: "audio", title: file.name.replace(/\.[^.]+$/, "").slice(0, 80), artist: "" });
                    } catch (er) { setMErr(er.message); } finally { setMUp(false); }
                  }} />
                </label>
              ) : (
                <div>
                  <audio src={media.url} controls preload="none" style={{ width: "100%", height: 36 }} />
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 1fr", gap: 8, marginTop: 8 }}>
                    <Select value={media.kind} onChange={(e) => setMedia({ ...media, kind: e.target.value })} style={inputStyle}><option value="voice">Voice note</option><option value="audio">Audio clip</option><option value="song">Song</option></Select>
                    <input value={media.title} onChange={(e) => setMedia({ ...media, title: e.target.value })} placeholder="Title" maxLength={80} style={inputStyle} />
                    <input value={media.artist} onChange={(e) => setMedia({ ...media, artist: e.target.value })} placeholder="Artist / speaker (optional)" maxLength={80} style={inputStyle} />
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{(media.bytes / 1048576).toFixed(1)} MB{media.dur ? ` · ${Math.floor(media.dur / 60)}:${String(media.dur % 60).padStart(2, "0")}` : ""} · the app downloads it in the background (large files too) and plays it from the notification inbox.</div>
                  <button style={{ ...btn(), marginTop: 8 }} onClick={() => setMedia(null)}>Remove audio</button>
                </div>
              )}
              {mErr && <div style={{ color: C.flag, fontSize: 12.5, marginTop: 6 }}>{mErr}</div>}
            </div>
          )}
          {!isPush && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Blank line = new paragraph · <code>## Heading</code> · <code>- bullet</code> · <code>**bold**</code> · <code>[link text](https://…)</code> · personalise with <code>{"{{firstName}}"}</code></div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <label style={label}>{isPush ? "Opens (optional link)" : "Button text (optional)"}<input value={isPush ? f.ctaUrl : f.ctaLabel} onChange={(e) => set(isPush ? "ctaUrl" : "ctaLabel", e.target.value)} placeholder={isPush ? "https://… or /premium" : "e.g. See what's new"} style={inputStyle} /></label>
            {!isPush && <label style={label}>Button link<input value={f.ctaUrl} onChange={(e) => set("ctaUrl", e.target.value)} placeholder="https://… or /premium" style={inputStyle} /></label>}
          </div>
          <div style={sect}>Type</div>
          <Select value={f.kind} onChange={(e) => set("kind", e.target.value)} style={inputStyle}>
            <option value="marketing">Announcement / offer — respects people's "Announcements & offers" setting{isPush ? "" : " and includes an unsubscribe link"}</option>
            <option value="service">Service notice — outage, security or legal; ignores that setting</option>
          </Select>
          {isPush && <div style={{ marginTop: 10 }}>{check("Also add it to people's in-app notifications", f.inApp, (e) => set("inApp", e.target.checked))}</div>}

          <div style={sect}>Audience</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {PRESETS.map(([n, p]) => <button key={n} style={{ ...btn(), borderRadius: 999, padding: "3px 10px" }} onClick={() => set("audience", { ...EMPTY_AUD, ...p })}>{n}</button>)}
          </div>
          <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
            {[["all", "Everyone"], ["segment", "Segment"], ["individuals", "Specific people"]].map(([v, l]) => <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="radio" checked={aud.mode === v} onChange={() => setAud({ mode: v })} />{l}</label>)}
          </div>
          {aud.mode === "segment" && (
            <div style={{ display: "grid", gap: 10, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
              <div><span style={label}>Plan</span><div style={{ display: "flex", gap: 14 }}>{[["basic", "OUT"], ["plus", "OUT+"], ["pro", "OUT PRO"]].map(([v, l]) => <span key={v}>{check(l, aud.plans.includes(v), () => setAud({ plans: toggle(aud.plans, v) }))}</span>)}</div></div>
              <label style={{ fontSize: 12, color: C.muted }}>Countries (codes, comma-separated)<input value={aud.countries} onChange={(e) => setAud({ countries: e.target.value })} placeholder="KE, US, GB" style={{ ...inputStyle, marginTop: 4 }} /></label>
              <div><span style={label}>Must be verified</span><div style={{ display: "flex", gap: 14 }}>{[["id", "ID"], ["email", "Email"], ["phone", "Phone"]].map(([v, l]) => <span key={v}>{check(l, aud.verified.includes(v), () => setAud({ verified: toggle(aud.verified, v) }))}</span>)}</div></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>{num("activeDays", "Active in last N days")}{num("inactiveDays", "Inactive for N+ days")}{num("joinedDays", "Joined in last N days")}</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{check("Staff only", aud.staffOnly, (e) => setAud({ staffOnly: e.target.checked }))}{check("Has an open support ticket", aud.hasOpenTicket, (e) => setAud({ hasOpenTicket: e.target.checked }))}</div>
              <label style={{ fontSize: 12, color: C.muted }}>Two-factor<Select value={aud.twoFactor} onChange={(e) => setAud({ twoFactor: e.target.value })} style={{ ...inputStyle, marginTop: 4 }}><option value="">Any</option><option value="yes">Turned on</option><option value="no">Turned off</option></Select></label>
            </div>
          )}
          {aud.mode === "individuals" && <label style={label}>Handles, emails or account IDs — separated by commas or new lines<textarea rows={4} value={aud.people} onChange={(e) => setAud({ people: e.target.value })} style={inputStyle} /></label>}
          <div style={{ ...card, marginTop: 12, background: C.paper, padding: "10px 12px" }}>
            {reach ? (<><div style={{ fontSize: 22, fontWeight: 800 }}>{reach.reachable.toLocaleString()} <span style={{ fontSize: 13, fontWeight: 500, color: C.muted }}>will receive it</span></div>
              <div style={{ fontSize: 12, color: C.muted }}>{reach.label} · {reach.matched.toLocaleString()} match{reach.matched - reach.reachable > 0 ? `, ${(reach.matched - reach.reachable).toLocaleString()} can't be reached (${isPush ? "no registered device" : "unverified email"} or opted out)` : ""}</div>
              {reach.sample.length > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>e.g. {reach.sample.join(", ")}</div>}</>) : <span style={{ color: C.muted, fontSize: 13 }}>Calculating…</span>}
          </div>

          <div style={sect}>When</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="radio" checked={f.schedule === "now"} onChange={() => set("schedule", "now")} />Send now</label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}><input type="radio" checked={f.schedule === "later"} onChange={() => set("schedule", "later")} />Schedule</label>
            {f.schedule === "later" && <input type="datetime-local" value={f.scheduleAt} onChange={(e) => set("scheduleAt", e.target.value)} style={{ ...inputStyle, width: "auto" }} />}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
            <button style={{ ...btn("primary"), padding: "9px 18px" }} disabled={busy || !ready || !reach?.reachable || (f.schedule === "later" && !f.scheduleAt)} onClick={() => setConfirm(true)}>{f.schedule === "later" ? "Schedule…" : "Send…"}</button>
            {!isPush && <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Test to (default: your email)" style={{ ...inputStyle, width: 220 }} />}
            <button style={btn()} disabled={busy || !ready} onClick={test}>{isPush ? "Send test to my devices" : "Send test email"}</button>
          </div>
        </div>

        {/* ---------------- preview ---------------- */}
        <div style={{ position: "sticky", top: 70 }}>
          <div style={{ ...sect, marginTop: 0 }}>Preview</div>
          {isPush ? (
            <div style={{ background: "linear-gradient(160deg,#1c2540,#0c1423)", borderRadius: 18, padding: 18 }}>
              <div style={{ ...monoFont, fontSize: 12, color: "#9aa7c7", textAlign: "center", marginBottom: 10 }}>Lock screen</div>
              <div style={{ background: "rgba(255,255,255,.14)", backdropFilter: "blur(10px)", borderRadius: 16, padding: "10px 12px", display: "flex", gap: 10, color: "#fff" }}>
                <img src="/logo-mark.png" alt="" width={34} height={34} style={{ borderRadius: 8, background: "#0c1423" }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#c5cde3", display: "flex", justifyContent: "space-between" }}><span>LINKEDOUT</span><span>now</span></div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{f.title || "Your title"}</div>
                  <div style={{ fontSize: 13, color: "#e6eaf6", lineHeight: 1.35 }}>{f.body || "Your message appears here."}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden", background: "#fff" }}>
              <div style={{ padding: "8px 12px", fontSize: 12, borderBottom: `1px solid ${C.line}`, color: "#111", background: "#fafafa" }}><b>{f.subject || "Subject line"}</b><div style={{ color: "#666" }}>{f.preheader || "Preview text"}</div></div>
              <iframe title="Email preview" srcDoc={html} sandbox="" style={{ width: "100%", height: 640, border: 0, background: "#F4F6FB" }} />
            </div>
          )}
        </div>
      </div>

      {/* ---------------- history ---------------- */}
      <div style={{ ...sect, marginTop: 26 }}>History</div>
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Message", "Audience", "Type", "Status", "Delivered", "When", ""].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 12, color: C.muted, textTransform: "uppercase", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {data.history.length === 0 && <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: C.muted }}>Nothing sent yet.</td></tr>}
            {data.history.map((h) => (
              <tr key={h.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                <td style={{ padding: "8px 12px", maxWidth: 280 }}><b>{h.name || h.title}</b><div style={{ color: C.muted, fontSize: 12 }}>{h.by || "staff"}</div>{h.error && <div style={{ color: C.flag, fontSize: 12 }}>{h.error}</div>}</td>
                <td style={{ padding: "8px 12px", maxWidth: 220, fontSize: 12.5 }}>{h.audience}</td>
                <td style={{ padding: "8px 12px" }}>{h.kind === "service" ? "service" : "announcement"}</td>
                <td style={{ padding: "8px 12px" }}><span style={{ ...monoFont, fontSize: 12, color: stateColor(h.status), border: `1px solid ${stateColor(h.status)}55`, borderRadius: 99, padding: "1px 8px" }}>{h.status}</span></td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{h.status === "scheduled" ? "—" : `${h.sent.toLocaleString()} / ${h.total.toLocaleString()}`}{h.failed > 0 && <span style={{ color: C.flag }}> · {h.failed} failed</span>}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", fontSize: 12 }}>{String(h.status === "scheduled" ? h.scheduledAt : h.finishedAt || h.createdAt).slice(0, 16).replace("T", " ")}</td>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap", textAlign: "right" }}>
                  {h.status === "scheduled" && <button style={{ ...btn("danger"), marginRight: 6 }} disabled={busy} onClick={() => cancel(h.id)}>Cancel</button>}
                  <button style={btn()} onClick={() => reuse(h)}>Reuse</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirm && (
        <Modal title={f.schedule === "later" ? "Schedule this broadcast?" : "Send this broadcast now?"} onClose={() => setConfirm(false)}>
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>
            <b>{reach?.reachable.toLocaleString()}</b> {reach?.reachable === 1 ? "person" : "people"} will receive this {isPush ? "push notification" : "email"} ({reach?.label}).
            {f.schedule === "later" && <> It will go out on <b>{new Date(f.scheduleAt).toLocaleString()}</b>.</>}
            {f.kind === "service" && <div style={{ color: C.mustard, marginTop: 8 }}>This is a service notice, so it ignores people's opt-out settings. Use it only for genuinely important messages.</div>}
            <div style={{ color: C.muted, marginTop: 8, fontSize: 12.5 }}>You can cancel a scheduled broadcast any time before it starts. Once sending begins it can't be recalled.</div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button style={btn()} onClick={() => setConfirm(false)}>Back</button>
            <button style={btn("primary")} disabled={busy} onClick={send}>{busy ? "Working…" : f.schedule === "later" ? "Schedule" : "Send now"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
