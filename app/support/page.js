"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import Select from "@/components/ui/Select";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Mail, Clock, ShieldCheck, LifeBuoy, CheckCircle2, MessageSquare } from "lucide-react";
import { C, monoFont, displayFont, radius } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import { useDialog } from "@/components/Dialog";
import { SUPPORT_CATEGORIES } from "@/lib/support-categories";
import { COMPANY, hasCompany } from "@/lib/company";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "";
const call = async (url, opts) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts }).catch(() => { throw new Error("You're offline, or we can't reach LinkedOut right now."); });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status >= 500 ? "Something went wrong on our side. Please try again." : d.error || "Something went wrong.");
  return d;
};
const EMPTY = { category: "general", subject: "", body: "", name: "", email: "", website: "" };

// Help & Support is also the Contact page: anyone (signed in or not) can write to us here, and
// people with an account can follow the conversation under "My requests".
export default function SupportPage() {
  const { user, loading } = useAuth();
  const dialog = useDialog();
  const [tab, setTab] = useState("contact");
  const [tickets, setTickets] = useState(null), [open, setOpen] = useState(null), [thread, setThread] = useState(null);
  const [f, setF] = useState(EMPTY), [reply, setReply] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [sent, setSent] = useState(null);

  const input = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "11px 13px", fontSize: 14.5, width: "100%", minHeight: 44 };
  const label = { fontSize: 12.5, fontWeight: 600, color: C.muted, marginBottom: 6, display: "block" };
  const btn = (p) => ({ ...monoFont, fontSize: 13, fontWeight: 700, borderRadius: 10, padding: "10px 18px", cursor: "pointer", color: p ? "#fff" : C.text, background: p ? "var(--lo-grad)" : "transparent", border: p ? "none" : `1px solid ${C.line}` });

  const loadList = useCallback(() => call("/api/support").then((d) => setTickets(d.tickets)).catch((e) => setErr(e.message)), []);
  const loadThread = useCallback((id) => call(`/api/support/${id}`).then(setThread).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (user) loadList(); }, [user, loadList]);
  useEffect(() => { if (open) loadThread(open); else setThread(null); }, [open, loadThread]);

  if (loading) return <Loading variant="list" />;

  const canSend = f.subject.trim() && f.body.trim().length >= 10 && (user || /\S+@\S+\.\S+/.test(f.email));
  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await call("/api/contact", { method: "POST", body: JSON.stringify(f) });
      setSent(r); setF(EMPTY);
      if (user) loadList();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setErr(null);
    try { await call(`/api/support/${open}`, { method: "POST", body: JSON.stringify({ body: reply }) }); setReply(""); await loadThread(open); loadList(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const Info = ({ icon: Icon, title, children }) => (
    <div className="flex gap-3" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: radius.lg, padding: "14px 16px", flex: 1, minWidth: 220 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: "color-mix(in srgb, var(--lo-mustard) 14%, transparent)", color: C.mustard, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon size={18} /></div>
      <div><div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div><div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginTop: 2 }}>{children}</div></div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 760, margin: "0 auto" }}>
      <div>
        <div style={{ ...monoFont, fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.mustard }}>Help &amp; Support</div>
        <h1 style={{ ...displayFont, fontSize: 28, color: C.text, margin: "4px 0 6px" }}>How can we help?</h1>
        <p style={{ fontSize: 15, color: C.muted, lineHeight: 1.55, margin: 0 }}>Questions, problems, feedback, press or partnerships: write to us here. You don&apos;t need an account.</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Info icon={Clock} title="Reply time">We usually reply within two working days. Safety and privacy messages go to the front of the queue.</Info>
        <Info icon={Mail} title="By email">{SUPPORT_EMAIL ? <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: C.mustard, fontWeight: 600 }}>{SUPPORT_EMAIL}</a> : "Use the form below and we'll reply to the address you give."}</Info>
        {hasCompany && <Info icon={LifeBuoy} title={COMPANY.name}>{[COMPANY.address, COMPANY.regNo && `Reg. no. ${COMPANY.regNo}`].filter(Boolean).join(" · ") || "LinkedOut is operated by this company."}</Info>}
        <Info icon={ShieldCheck} title="Stay safe">We will never ask for your password or a verification code.</Info>
      </div>

      {user && (
        <div className="flex gap-2" role="tablist">
          {[["contact", "Contact us", MessageSquare], ["mine", "My requests", LifeBuoy]].map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpen(null); setSent(null); setErr(null); }}
              style={{ ...monoFont, display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13.5, fontWeight: 650, padding: "9px 16px", borderRadius: 999, cursor: "pointer", color: tab === k ? "#fff" : C.muted, background: tab === k ? "var(--lo-grad)" : C.surface, border: tab === k ? "1px solid transparent" : `1px solid ${C.line}` }}>
              <Icon size={15} />{l}{k === "mine" && tickets?.length ? ` (${tickets.length})` : ""}
            </button>
          ))}
        </div>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}

      {tab === "contact" && (sent ? (
        <div className="flex flex-col gap-3 items-start" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: radius.lg, padding: 20 }}>
          <CheckCircle2 size={30} color={C.green} />
          <div style={{ ...displayFont, fontSize: 20, color: C.text }}>Message sent</div>
          <p style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.55, margin: 0 }}>Your reference is <b style={{ color: C.text }}>{sent.ref}</b>. We&apos;ve emailed you a confirmation, and we&apos;ll reply by email{user ? " (and here under My requests)" : ""}.</p>
          <button style={btn(false)} onClick={() => setSent(null)}>Send another message</button>
        </div>
      ) : (
        <div className="flex flex-col gap-4" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: radius.lg, padding: 20 }}>
          {!user && (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div><label style={label} htmlFor="c-name">Your name <span style={{ fontWeight: 400 }}>(optional)</span></label><input id="c-name" autoComplete="name" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={input} /></div>
              <div><label style={label} htmlFor="c-email">Email we can reply to</label><input id="c-email" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={input} /></div>
            </div>
          )}
          <div><span style={label}>What is this about?</span><Select aria-label="Topic" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} style={{ ...input, width: "100%" }}>{SUPPORT_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
          <div><label style={label} htmlFor="c-subject">Subject</label><input id="c-subject" maxLength={140} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} style={input} /></div>
          <div><label style={label} htmlFor="c-body">Message</label><textarea id="c-body" rows={7} maxLength={4000} placeholder="Tell us what's going on. The more detail, the faster we can help." value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} style={{ ...input, resize: "vertical", lineHeight: 1.5 }} /><div style={{ ...monoFont, fontSize: 12, color: C.muted, textAlign: "right", marginTop: 4 }}>{f.body.length}/4000</div></div>
          {/* Honeypot: invisible to people, irresistible to form-filling bots. */}
          <input tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} />
          <div className="flex gap-3 items-center justify-between flex-wrap">
            <span style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, maxWidth: 380 }}>By sending this you agree we can use your details to reply. See our <Link href="/privacy" style={{ color: C.mustard }}>Privacy Policy</Link>.</span>
            <button style={{ ...btn(true), opacity: canSend ? 1 : 0.5 }} disabled={busy || !canSend} onClick={create}>{busy ? "Sending…" : "Send message"}</button>
          </div>
        </div>
      ))}

      {tab === "mine" && user && !open && (tickets === null ? <Loading variant="list" /> : tickets.length === 0
        ? <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.6 }}>No requests yet. Anything you send from “Contact us” will show up here with our replies.</div>
        : tickets.map((t) => (
          <button key={t.id} onClick={() => setOpen(t.id)} style={{ textAlign: "left", background: C.surface, border: `1px solid ${C.line}`, borderRadius: radius.lg, padding: "13px 15px", cursor: "pointer", color: C.text }}>
            <div className="flex justify-between gap-2"><b style={{ fontSize: 14.5 }}>{t.subject}</b><span style={{ ...monoFont, fontSize: 12, fontWeight: 600, color: t.status === "open" ? C.mustard : t.status === "pending" ? C.corpblue : C.green }}>{t.status === "pending" ? "reply from support" : t.status}</span></div>
            <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 3 }}>{t.ref} · {new Date(t.updatedAt).toLocaleDateString()}</div>
          </button>
        )))}

      {tab === "mine" && open && thread && (
        <>
          <div className="flex items-center justify-between gap-3">
            <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{thread.ticket.ref} · {thread.ticket.subject} · {thread.ticket.status}</div>
            <button style={btn(false)} onClick={() => setOpen(null)}>← All requests</button>
          </div>
          <div className="flex flex-col gap-2">
            {thread.messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.from === "you" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.from === "you" ? "color-mix(in srgb, var(--lo-mustard) 14%, transparent)" : C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 14px" }}>
                <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{m.from === "you" ? "You" : "LinkedOut Support"} · {new Date(m.at).toLocaleString()}</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, color: C.text, lineHeight: 1.5 }}>{m.body}</div>
              </div>
            ))}
          </div>
          <textarea rows={3} placeholder={["resolved", "closed"].includes(thread.ticket.status) ? "Reply to reopen this request…" : "Write a reply…"} value={reply} onChange={(e) => setReply(e.target.value)} style={{ ...input, resize: "vertical" }} />
          <div className="flex justify-end"><button style={{ ...btn(true), opacity: reply.trim() ? 1 : 0.5 }} disabled={busy || !reply.trim()} onClick={send}>Send reply</button></div>
        </>
      )}
    </div>
  );
}
