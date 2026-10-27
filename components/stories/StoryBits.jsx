"use client";
import Link from "next/link";
import { useImpression } from "@/lib/impressions";
import { useState } from "react";
import { ShieldCheck, Paperclip, Users, Building2, Quote, Heart, Handshake, Check, MessageSquareReply, BadgeCheck, EyeOff } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { useRouter } from "next/navigation";

// Evidence/credibility badges. These describe what LinkedOut KNOWS about a story;
// none of them says "true".
const BADGE_TONE = {
  personal: { icon: Quote, tone: "muted" }, evidence: { icon: Paperclip, tone: "blue" }, multiple: { icon: Users, tone: "amber" }, public: { icon: ShieldCheck, tone: "green" },
  verified_employment: { icon: BadgeCheck, tone: "green" }, claimed_former: { icon: Building2, tone: "muted" }, claimed_current: { icon: Building2, tone: "muted" }, company_response: { icon: MessageSquareReply, tone: "blue" },
};
const TONE = { muted: C.muted, blue: C.corpblue, amber: C.mustard, green: C.green };

export function Badge({ badge }) {
  const meta = BADGE_TONE[badge.key] || BADGE_TONE.personal; const Icon = meta.icon; const color = TONE[meta.tone];
  return (
    <span className="inline-flex items-center gap-1" style={{ ...monoFont, fontSize: 12, fontWeight: 600, color, background: alpha(color, 12), border: `1px solid ${alpha(color, 30)}`, borderRadius: 999, padding: "2px 9px" }}>
      <Icon size={12} /> {badge.label}
    </span>
  );
}

export function Chip({ children, active, onClick, href, tone }) {
  const color = tone ? TONE[tone] : active ? C.mustard : C.muted;
  const style = { ...monoFont, fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "#fff" : color, background: active ? C.mustard : "transparent", border: `1px solid ${active ? C.mustard : C.line}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none", display: "inline-block" };
  if (href) return <Link href={href} className="lo-tap" style={style}>{children}</Link>;
  return <button type="button" onClick={onClick} className="lo-tap" style={style}>{children}</button>;
}

// "What they told me" vs "What actually happened" — LinkedOut's signature format.
export function ToldVsActual({ told, actual, label = ["What they told me", "What actually happened"] }) {
  if (!told && !actual) return null;
  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
      {told && <div style={{ background: "var(--lo-sunken)", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px" }}>
        <div className="lo-eyebrow" style={{ marginBottom: 4 }}>{label[0]}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, color: C.text, fontStyle: "italic" }}>“{told}”</div>
      </div>}
      {actual && <div style={{ background: alpha(C.flag, 8), border: `1px solid ${alpha(C.flag, 28)}`, borderRadius: 12, padding: "10px 12px" }}>
        <div className="lo-eyebrow" style={{ marginBottom: 4, color: C.flag }}>{label[1]}</div>
        <div style={{ fontSize: 14.5, lineHeight: 1.5, color: C.text }}>{actual}</div>
      </div>}
    </div>
  );
}

// "Is this happening to anyone else?" — the core interaction (replaces the Like button).
export function MeTooBar({ story, onChange, compact = false }) {
  const { user } = useAuth();
  const router = useRouter();
  const [counts, setCounts] = useState(story.counts);
  const [mine, setMine] = useState(story.mine);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const own = story.isOwner;

  async function send(kind, sameCompany) {
    if (!user) { router.push("/login"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.meToo(story.id, kind, sameCompany);
      setCounts((c) => ({ ...c, ...r })); setMine(r.mine); setPicking(false); onChange?.(r);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }
  const total = counts.total || 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!own && (mine ? (
          <button onClick={() => send("off")} disabled={busy} className="lo-tap lo-btn lo-btn-secondary lo-btn-sm" style={{ color: C.mustard, borderColor: alpha(C.mustard, 50) }}>
            <Check size={14} /> {mine === "same" ? "This happened to me too" : "Something similar happened to me"}
          </button>
        ) : (
          <button onClick={() => (user ? setPicking((p) => !p) : router.push("/login"))} disabled={busy} className="lo-tap lo-btn lo-btn-primary lo-btn-sm"><Handshake size={14} /> This happened to me too</button>
        ))}
        <span style={{ ...monoFont, fontSize: 13, color: C.text2 }}>
          {total === 0 ? (own ? "Nobody has said this happened to them yet." : "Be the first to say this happened to you.")
            : `${total} ${total === 1 ? "person has" : "people have"} reported a similar experience`}
        </span>
      </div>
      {total > 0 && (
        <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>
          {counts.sameCompany > 0 && <>{counts.sameCompany} at the same company</>}
          {counts.sameCompany > 0 && counts.otherCompanies > 0 && " · "}
          {counts.otherCompanies > 0 && <>{counts.otherCompanies} at other companies</>}
        </div>
      )}
      {picking && !mine && (
        <div style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }} className="flex flex-col gap-2">
          <div style={{ fontSize: 13.5, color: C.text, fontWeight: 600 }}>Was this at the same company?</div>
          <div className="flex gap-2 flex-wrap">
            <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => send("same", true)}>Same company</button>
            <button className="lo-btn lo-btn-secondary lo-btn-sm" onClick={() => send("same", false)}>A different company</button>
            <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={() => send("similar", false)}>Similar, not identical</button>
          </div>
          <div style={{ fontSize: 12.5, color: C.muted }}>Only the counts are shown. Nobody sees who you are.</div>
        </div>
      )}
      {err && <div style={{ ...monoFont, fontSize: 12.5, color: C.flag }}>{err}</div>}
    </div>
  );
}

export function StoryCard({ story, linkTitle = true }) {
  const s = story;
  const viewRef = useImpression("story", s.id);
  const excerpt = s.body.length > 360 ? `${s.body.slice(0, 360).trim()}…` : s.body;
  return (
    <article ref={viewRef} className="lo-card flex flex-col gap-3" style={{ padding: 16 }}>
      <div className="flex items-center gap-2 flex-wrap" style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>
        <span style={{ color: C.mustard, fontWeight: 700 }}>{s.formatLabel}</span>
        {s.company && <>· {s.companyId ? <Link href={`/companies/${s.companyId}`} style={{ color: C.text2, textDecoration: "none", fontWeight: 600 }}>{s.company}</Link> : <span style={{ color: C.text2, fontWeight: 600 }}>{s.company}</span>}</>}
        <span>· {s.author.startsWith("Anonymous") ? <EyeOff size={11} style={{ display: "inline", verticalAlign: "-1px" }} /> : null} {s.author}</span>
        <span>· {s.time}</span>
      </div>
      {(s.title || s.categories.length > 0) && (
        <div className="flex flex-col gap-2">
          {s.title && <h2 style={{ margin: 0, fontSize: 18, fontWeight: 720, lineHeight: 1.3, letterSpacing: "-0.01em" }}>{linkTitle ? <Link href={`/stories/${s.id}`} style={{ color: C.text, textDecoration: "none" }}>{s.title}</Link> : s.title}</h2>}
          {s.categories.length > 0 && <div className="flex gap-1.5 flex-wrap">{s.categories.map((c) => <Chip key={c} href={`/?category=${encodeURIComponent(c)}`}>{c}</Chip>)}</div>}
        </div>
      )}
      <ToldVsActual told={s.told} actual={s.actual} />
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: C.text, whiteSpace: "pre-wrap" }}>{excerpt}</p>
      {s.noAdvice && <div style={{ ...monoFont, fontSize: 12.5, color: C.muted, background: C.surface2, borderRadius: 10, padding: "6px 10px" }}>This person is sharing, not asking for solutions. No advice, please.</div>}
      {s.pattern && <div style={{ ...monoFont, fontSize: 13, color: C.text, background: alpha(C.mustard, 12), border: `1px solid ${alpha(C.mustard, 35)}`, borderRadius: 10, padding: "8px 10px" }}>{s.pattern.text}</div>}
      <div className="flex gap-1.5 flex-wrap">{s.badges.map((b) => <Badge key={b.key} badge={b} />)}</div>
      <MeTooBar story={s} />
      <div className="flex items-center gap-3 flex-wrap" style={{ ...monoFont, fontSize: 12.5, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
        {s.counts.updates > 0 && <Link href={`/stories/${s.id}#updates`} style={{ color: C.text2, textDecoration: "none" }}>{s.counts.updates} update{s.counts.updates === 1 ? "" : "s"}</Link>}
        {s.counts.evidence > 0 && <span>{s.counts.evidence} piece{s.counts.evidence === 1 ? "" : "s"} of evidence</span>}
        {s.counts.responses > 0 && <span>{s.counts.responses} company response{s.counts.responses === 1 ? "" : "s"}</span>}
        <Link href={`/stories/${s.id}`} style={{ marginLeft: "auto", color: C.mustard, textDecoration: "none", fontWeight: 650 }}>Read the full story →</Link>
      </div>
    </article>
  );
}
