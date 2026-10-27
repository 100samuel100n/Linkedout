"use client";
import { Spinner } from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import VerifiedTick from "@/components/VerifiedTick";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, EyeOff, UserPlus, UserCheck, Mail, X, Zap, Sparkles, Send } from "lucide-react";
import { C, monoFont, displayFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import PostCard from "@/components/PostCard";

export default function AliasProfilePage() {
  const { handle } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api.getAliasProfile(handle).then(setProfile).catch((e) => setError(e.status === 404 ? "There's no profile here." : e.message));
  }, [handle]);

  async function toggleFollow() {
    if (!user || followBusy) return;
    setFollowBusy(true);
    const wasFollowing = profile.isFollowing;
    setProfile((p) => ({ ...p, isFollowing: !wasFollowing, followerCount: p.followerCount + (wasFollowing ? -1 : 1) }));
    try {
      if (wasFollowing) await api.unfollowHandle(handle); else await api.followHandle(handle);
    } catch {
      setProfile((p) => ({ ...p, isFollowing: wasFollowing, followerCount: p.followerCount + (wasFollowing ? 1 : -1) })); // revert
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => router.back()}
        className="lo-tap flex items-center gap-1.5"
        style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 4, borderRadius: 8 }}
      >
        <ArrowLeft size={15} /> Back
      </button>

      {error && <ErrorNote>{error}</ErrorNote>}

      {!profile && !error && <div className="lo-skeleton" style={{ height: 90 }} />}

      {profile && (
        <>
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5 flex items-center gap-4">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted }}>
                {profile.displayLabel[0]}
              </div>
            )}
            <div className="flex flex-col gap-1" style={{ flex: 1 }}>
              <div style={{ ...displayFont, fontSize: 18, fontWeight: 800, color: C.text }}><span className="inline-flex items-center">{profile.displayLabel}<VerifiedTick tier={profile.tier} size={17} /></span></div>
              <div className="flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
                <EyeOff size={11} /> A pseudonym, not a real identity
              </div>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>
                {profile.postCount} post{profile.postCount === 1 ? "" : "s"} · {profile.followerCount} follower{profile.followerCount === 1 ? "" : "s"} · {profile.totalReactions} reaction{profile.totalReactions === 1 ? "" : "s"}
              </div>
            </div>
            {!profile.isSelf && user && (
              <button onClick={() => setComposeOpen(true)} className="lo-tap flex items-center gap-1.5" aria-label="Message"
                style={{ ...monoFont, fontSize: 12, fontWeight: 700, borderRadius: 20, padding: "8px 14px", cursor: "pointer", color: C.text, background: "transparent", border: `1px solid ${C.line}` }}>
                <Mail size={13} /> Message
              </button>
            )}
            {!profile.isSelf && user && (
              <button
                onClick={toggleFollow}
                disabled={followBusy}
                className="lo-tap flex items-center gap-1.5"
                style={{
                  ...monoFont, fontSize: 12, fontWeight: 700, borderRadius: 20, padding: "8px 14px", cursor: "pointer",
                  color: profile.isFollowing ? C.text : "#FFFFFF",
                  background: profile.isFollowing ? "transparent" : C.mustard,
                  border: profile.isFollowing ? `1px solid ${C.line}` : "none",
                }}
              >
                {profile.isFollowing ? <UserCheck size={13} /> : <UserPlus size={13} />}
                {profile.isFollowing ? "Following" : "Follow"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {profile.posts.length === 0 && (
              <div style={{ ...monoFont, fontSize: 12, color: C.muted, textAlign: "center", padding: "24px 0" }}>Nothing public here yet.</div>
            )}
            {profile.posts.map((p) => <PostCard key={p.id} post={p} />)}
          </div>
          {composeOpen && <MessageRequestDialog handle={handle} name={profile.displayLabel || profile.pseudonym || 'this person'} onClose={() => setComposeOpen(false)} router={router} />}
        </>
      )}
    </div>
  );
}


function MessageRequestDialog({ handle, name, onClose, router }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [errCode, setErrCode] = useState(null);
  const [perks, setPerks] = useState(null);
  const [ai, setAi] = useState({ open: false, goal: "", busy: false, drafts: null, err: null });
  useEffect(() => { api.getMessagePerks().then(setPerks).catch(() => {}); }, []);
  const max = perks?.requestMaxLen || 300;

  async function send() {
    setBusy(true); setErr(null); setErrCode(null);
    try {
      const r = await api.startConversation(handle, text);
      router.push(`/messages/${r.conversationId}`);
    } catch (e) {
      if (e.body?.conversationId) router.push(`/messages/${e.body.conversationId}`);
      else { setErr(e.message); setErrCode(e.body?.code || null); }
    } finally { setBusy(false); }
  }
  async function draft() {
    setAi((a) => ({ ...a, busy: true, err: null }));
    try { const r = await api.aiOutreach(handle, ai.goal); setAi((a) => ({ ...a, busy: false, drafts: r.drafts })); }
    catch (e) { setAi((a) => ({ ...a, busy: false, err: e.message })); }
  }
  const isPro = perks?.aiOutreach;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(3,7,20,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Send message request" onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 18, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto", boxShadow: "var(--lo-shadow-2)" }} className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: "-0.01em" }}>Message {name}</div>
            {perks?.priority && <span className="lo-badge lo-badge-accent" style={{ marginTop: 6 }}><Zap size={12} /> Sent as a priority request</span>}
          </div>
          <button onClick={onClose} aria-label="Close" className="lo-btn lo-btn-ghost lo-btn-sm" style={{ padding: "0 8px" }}><X size={18} /></button>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: C.muted, lineHeight: 1.55 }}>This sends a request. They choose whether to accept, and you cannot send more until they do. Keep it short and respectful.</p>

        <div>
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={max} placeholder="Say why you're reaching out" aria-label="Your message" className="lo-field" style={{ resize: "none", lineHeight: 1.5 }} />
          <div className="flex items-center justify-between" style={{ marginTop: 6, fontSize: 13, color: C.muted }}>
            {isPro ? (
              <button type="button" onClick={() => setAi((a) => ({ ...a, open: !a.open }))} className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.mustard, padding: "0 8px" }}><Sparkles size={15} /> Draft with AI</button>
            ) : perks ? (
              <Link href="/premium" style={{ color: C.muted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={14} /> AI drafts <span className="lo-badge lo-badge-accent">OUT PRO</span></Link>
            ) : <span />}
            <span>{text.length}/{max}</span>
          </div>
        </div>

        {ai.open && isPro && (
          <div className="flex flex-col gap-3" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <label className="lo-label" htmlFor="ai-goal" style={{ margin: 0 }}>What do you want to say? <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span></label>
            <input id="ai-goal" value={ai.goal} onChange={(e) => setAi((a) => ({ ...a, goal: e.target.value }))} maxLength={280} placeholder="e.g. I read your post about interviews and have a question" className="lo-field" />
            <button type="button" onClick={draft} disabled={ai.busy} className="lo-btn lo-btn-secondary lo-btn-sm" style={{ alignSelf: "flex-start" }}>{ai.busy ? <Spinner size="sm" /> : <Sparkles size={15} />} {ai.drafts ? "Draft again" : "Write 3 options"}</button>
            {ai.err && <ErrorNote>{ai.err}</ErrorNote>}
            {ai.drafts?.map((d, i) => (
              <button key={i} type="button" onClick={() => { setText(d); setAi((a) => ({ ...a, open: false })); }} className="lo-row-hover" style={{ textAlign: "left", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "10px 12px", color: C.text, fontSize: 14, lineHeight: 1.5 }}>{d}</button>
            ))}
            {ai.drafts && <div style={{ fontSize: 13, color: C.muted }}>Tap one to use it, then edit freely before you send.</div>}
          </div>
        )}

        {err && (
          <div className="flex flex-col gap-2">
            <ErrorNote>{err}</ErrorNote>
            {errCode === "OUTSIDE_NETWORK" && <Link href="/premium" className="lo-btn lo-btn-secondary lo-btn-sm" style={{ alignSelf: "flex-start", textDecoration: "none" }}>See OUT+</Link>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="lo-btn lo-btn-ghost">Cancel</button>
          <button onClick={send} disabled={busy || !text.trim()} className="lo-btn lo-btn-primary">{busy ? <Spinner size="sm" /> : <Send size={16} />} Send request</button>
        </div>
      </div>
    </div>
  );
}
