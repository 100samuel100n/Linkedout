"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Paperclip, Mic, Sticker, ChevronLeft, MoreVertical, Send, Smile, X, Reply, Pencil, Trash2, Check, CheckCheck, BellOff, Bell, Timer, Flag, Ban, Lock, Copy, SmilePlus, Archive } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sounds";
import { Avatar } from "@/components/messages/ConversationList";
import { EmojiGrid, ReactionPopover } from "@/components/Reactions";
import Select from "@/components/ui/Select";
import GifPicker from "@/components/GifPicker";
import Attachment, { isMediaOnly } from "@/components/messages/Attachment";
import VoiceRecorder from "@/components/messages/VoiceRecorder";

const POLL_MS = 1600;
const TTLS = [[0, "Off"], [86400, "24 hours"], [604800, "7 days"]];
const REASONS = { spam: "Spam or scam", harassment: "Harassment or threats", sexual: "Unwanted sexual content", impersonation: "Impersonation", other: "Something else" };

function dayLabel(iso) {
  const d = new Date(iso), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Bubble({ m, readAt, onReply, onReact, onEdit, onDelete, onCopy, grouped, highlight, jumpTo }) {
  const [menu, setMenu] = useState(false);
  const reactAnchor = useRef(null);
  const [picker, setPicker] = useState(false);
  const touch = useRef({ x: 0, dx: 0, t: 0 });
  const [dx, setDx] = useState(0);
  const mine = m.mine;
  const seen = mine && readAt && new Date(readAt) >= new Date(m.createdAt);

  // Swipe right to reply (touch). Long-press opens the action menu.
  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, t: setTimeout(() => setMenu(true), 450) }; };
  const onTouchMove = (e) => {
    const t = touch.current; const mx = e.touches[0].clientX - t.x, my = e.touches[0].clientY - t.y;
    if (Math.abs(my) > 14 || Math.abs(mx) > 8) clearTimeout(t.t);
    if (mx > 0 && Math.abs(my) < 24) { t.dx = Math.min(mx, 72); setDx(t.dx); }
  };
  const onTouchEnd = () => { clearTimeout(touch.current.t); if (touch.current.dx > 56 && !m.deleted) { navigator.vibrate?.(8); onReply(m); } setDx(0); };

  if (m.deleted) {
    return (
      <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: grouped ? 2 : 10 }}>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, fontStyle: "italic", border: `1px solid ${C.line}`, borderRadius: 14, padding: "6px 12px" }}>
          {mine ? "You deleted this message" : "This message was deleted"}
        </div>
      </div>
    );
  }
  return (
    <div id={`m-${m.id}`} className="group" style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginTop: grouped ? 2 : 10, position: "relative" }}>
      {dx > 8 && <Reply size={16} color={C.mustard} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", opacity: Math.min(1, dx / 56) }} />}
      <div style={{ maxWidth: "min(78%, 520px)", display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", transform: `translateX(${dx}px)`, transition: dx ? "none" : "transform .18s" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div style={{
          background: mine ? "var(--lo-grad)" : C.surface2, color: mine ? "#fff" : C.text, border: mine ? "none" : `1px solid ${C.line}`,
          borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6, padding: "9px 13px 7px",
          boxShadow: highlight ? `0 0 0 2px ${alpha(C.mustard, 70)}` : "none", transition: "box-shadow .4s",
        }}>
          {m.replyTo && (
            <button onClick={() => jumpTo(m.replyTo.id)} style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer", background: mine ? "rgba(255,255,255,.18)" : C.surface2, border: "none", borderLeft: `3px solid ${mine ? "#fff" : C.mustard}`, borderRadius: 8, padding: "5px 9px", marginBottom: 5, color: "inherit" }}>
              <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>{m.replyTo.mine ? "You" : "Them"}</div>
              <div style={{ fontSize: 12, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: m.replyTo.deleted ? "italic" : "normal" }}>{m.replyTo.deleted ? "Message deleted" : m.replyTo.text}</div>
            </button>
          )}
          {m.attachment && <div style={{ marginBottom: m.text ? 6 : 0 }}><Attachment m={m} /></div>}
          {m.text ? <div style={{ fontSize: 15, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}</div> : null}
          <div className="flex items-center justify-end gap-1" style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
            {m.expiresAt && <Timer size={10} />}
            {m.editedAt && <span>edited</span>}
            <span>{hhmm(m.createdAt)}</span>
            {mine && (seen ? <CheckCheck size={13} color="#BFE3FF" /> : <Check size={13} />)}
          </div>
        </div>

        {m.reactions?.total > 0 && (
          <button onClick={() => onReact(m, m.reactions.mine || "❤️")} style={{ marginTop: -8, marginRight: mine ? 8 : 0, marginLeft: mine ? 0 : 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "1px 7px", fontSize: 12, cursor: "pointer", zIndex: 1, display: "flex", gap: 3, alignItems: "center" }}>
            {m.reactions.top.map(([e]) => <span key={e}>{e}</span>)}{m.reactions.total > 1 && <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{m.reactions.total}</span>}
          </button>
        )}
      </div>

      {/* hover actions (desktop) */}
      <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100" style={{ alignSelf: "center", order: mine ? -1 : 1, margin: "0 6px", transition: "opacity .12s" }}>
        <button ref={reactAnchor} onClick={() => setPicker(true)} aria-label="React" style={iconBtn()}><SmilePlus size={15} /></button>
        <button onClick={() => onReply(m)} aria-label="Reply" style={iconBtn()}><Reply size={15} /></button>
        <button onClick={() => setMenu(!menu)} aria-label="More" style={iconBtn()}><MoreVertical size={15} /></button>
      </div>

      {menu && (
        <>
          <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div role="menu" className="lo-toast" style={{ position: "absolute", zIndex: 41, top: "100%", [mine ? "right" : "left"]: 8, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 12px 32px rgba(0,0,0,.35)", padding: 4, minWidth: 170 }}>
            <MenuItem icon={SmilePlus} label="React" onClick={() => { setMenu(false); setPicker(true); }} />
            <MenuItem icon={Reply} label="Reply" onClick={() => { setMenu(false); onReply(m); }} />
            {m.text && <MenuItem icon={Copy} label="Copy" onClick={() => { setMenu(false); onCopy(m); }} />}
            {mine && !m.attachment && Date.now() - new Date(m.createdAt) < 15 * 60 * 1000 && <MenuItem icon={Pencil} label="Edit" onClick={() => { setMenu(false); onEdit(m); }} />}
            {mine && <MenuItem icon={Trash2} label="Delete for everyone" danger onClick={() => { setMenu(false); onDelete(m); }} />}
          </div>
        </>
      )}
      {picker && <ReactionPopover anchorRef={reactAnchor.current ? reactAnchor : { current: document.getElementById(`m-${m.id}`) }} onPick={(e) => { setPicker(false); onReact(m, e); }} onClose={() => setPicker(false)} current={m.reactions?.mine} />}
    </div>
  );
}
const iconBtn = () => ({ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 5, borderRadius: 8, display: "flex" });
function MenuItem({ icon: Icon, label, onClick, danger }) {
  return <button role="menuitem" onClick={onClick} className="lo-tap flex items-center gap-2 w-full" style={{ background: "none", border: "none", cursor: "pointer", padding: "8px 10px", borderRadius: 8, fontSize: 13, color: danger ? C.flag : C.text, textAlign: "left" }}><Icon size={14} /> {label}</button>;
}

export default function ChatPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [conv, setConv] = useState(null);
  const [perks, setPerks] = useState(null);
  useEffect(() => { api.getMessagePerks().then(setPerks).catch(() => {}); }, []);
  const [msgs, setMsgs] = useState([]);
  const [err, setErr] = useState(null);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [emoji, setEmoji] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState(null); // "report" | "timer" | "delete"
  const [highlight, setHighlight] = useState(null);
  const [notice, setNotice] = useState(null);
  const [recording, setRecording] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const scroller = useRef(null);
  const lastTime = useRef(null);
  const typingSent = useRef(0);
  const inputRef = useRef(null);
  const pending = useRef(new Set());

  const flash = (t) => { setNotice(t); setTimeout(() => setNotice((n) => (n === t ? null : n)), 3500); };

  // ---- load + poll ----
  const merge = useCallback((incoming, { replace = false } = {}) => {
    setMsgs((cur) => {
      const map = new Map((replace ? [] : cur).map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].filter((m) => !m.expiresAt || new Date(m.expiresAt) > new Date()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const load = useCallback(async (initial) => {
    try {
      const r = await api.getConversation(id, initial ? {} : { after: lastTime.current || undefined });
      setConv((c) => ({ ...(c || {}), ...r, messages: undefined }));
      if (initial) { merge(r.messages, { replace: true }); setHasMore(r.hasMore); }
      else if (r.messages.length) {
        const fresh = r.messages.filter((m) => !pending.current.has(m.id));
        if (fresh.some((m) => !m.mine)) playSound("received");
        merge(r.messages);
      }
      const all = r.messages;
      if (all.length) lastTime.current = all[all.length - 1].createdAt > (lastTime.current || "") ? all[all.length - 1].createdAt : lastTime.current;
      if (initial && !all.length) lastTime.current = null;
    } catch (e) { if (initial) setErr(e.message); }
  }, [id, merge]);

  useEffect(() => { setConv(null); setMsgs([]); lastTime.current = null; setErr(null); load(true); }, [id]); // eslint-disable-line
  useEffect(() => {
    // Full refresh each tick keeps edits, deletes, reactions and receipts live; cheap for 50 rows.
    const t = setInterval(async () => {
      if (document.hidden) return;
      try { const r = await api.getConversation(id, {}); setConv((c) => ({ ...(c || {}), ...r, messages: undefined })); setHasMore(r.hasMore);
        const knownIds = new Set(); setMsgs((cur) => { cur.forEach((m) => knownIds.add(m.id)); return cur; });
        const newIncoming = r.messages.filter((m) => !m.mine && !knownIds.has(m.id));
        if (newIncoming.length && knownIds.size) playSound("received");
        merge(r.messages, { replace: true });
      } catch { /* transient */ }
    }, POLL_MS * 2);
    return () => clearInterval(t);
  }, [id, merge]);

  // mark read whenever the chat is visible and something new arrived
  useEffect(() => {
    if (!conv || conv.status === "declined") return;
    const unreadIncoming = msgs.some((m) => !m.mine && !m.deleted);
    if (unreadIncoming && !document.hidden) api.markConversationRead(id).catch(() => {});
  }, [msgs.length, conv?.status, id]); // eslint-disable-line

  // scrolling
  useLayoutEffect(() => { if (atBottom) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs.length, conv?.otherTyping, atBottom]);
  const onScroll = (e) => { const t = e.currentTarget; setAtBottom(t.scrollHeight - t.scrollTop - t.clientHeight < 80); };

  async function loadOlder() {
    if (!msgs.length) return;
    const r = await api.getConversation(id, { before: msgs[0].createdAt });
    const el = scroller.current; const prev = el.scrollHeight;
    merge(r.messages); setHasMore(r.hasMore);
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prev; });
  }

  // ---- composing ----
  function onType(v) {
    setText(v);
    const t = inputRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }
    if (v && Date.now() - typingSent.current > 3000 && conv?.status === "active") { typingSent.current = Date.now(); api.sendTyping(id).catch(() => {}); }
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    if (editing) {
      try { const m = await api.editDm(editing.id, body); merge([m]); setEditing(null); setText(""); } catch (e) { flash(e.message); }
      return;
    }
    const clientId = crypto.randomUUID();
    const tempId = "tmp-" + clientId;
    const optimistic = { id: tempId, mine: true, text: body, createdAt: new Date().toISOString(), reactions: { total: 0, top: [], mine: null }, replyTo: replyTo ? { id: replyTo.id, mine: replyTo.mine, text: replyTo.text.slice(0, 140) } : null, sending: true };
    setMsgs((c) => [...c, optimistic]); setText(""); setReplyTo(null); setAtBottom(true);
    if (inputRef.current) inputRef.current.style.height = "auto";
    playSound("sent");
    try {
      const m = await api.sendDm(id, { text: body, replyTo: replyTo?.id, clientId });
      pending.current.add(m.id);
      setMsgs((c) => [...c.filter((x) => x.id !== tempId && x.id !== m.id), m]);
      lastTime.current = m.createdAt > (lastTime.current || "") ? m.createdAt : lastTime.current;
    } catch (e) {
      setMsgs((c) => c.filter((x) => x.id !== tempId));
      setText(body); flash(e.message);
    }
  }
  // Sends a sticker/GIF/voice note/file. Optimistic bubble first, then the real message replaces it.
  async function sendRich(attachment, caption = "") {
    const clientId = crypto.randomUUID(); const tempId = "tmp-" + clientId;
    setMsgs((c) => [...c, { id: tempId, mine: true, text: caption, attachment, createdAt: new Date().toISOString(), reactions: { total: 0, top: [], mine: null }, replyTo: replyTo ? { id: replyTo.id, mine: replyTo.mine, text: replyTo.text.slice(0, 140) } : null, sending: true }]);
    const rt = replyTo?.id; setReplyTo(null); setAtBottom(true); playSound("sent");
    try {
      const m = await api.sendDm(id, { text: caption, replyTo: rt, clientId, attachment });
      pending.current.add(m.id);
      setMsgs((c) => [...c.filter((x) => x.id !== tempId && x.id !== m.id), m]);
      lastTime.current = m.createdAt > (lastTime.current || "") ? m.createdAt : lastTime.current;
    } catch (e) { setMsgs((c) => c.filter((x) => x.id !== tempId)); flash(e.message); }
  }
  async function upload(file, kind, dur, name) {
    setUploading(true);
    try { const a = await api.uploadDmMedia(file, { kind, dur, name }); await sendRich(a); }
    catch (e) { flash(e.code === "PLAN_REQUIRED" || e.status === 403 ? e.message : e.message || "Couldn't upload that."); }
    finally { setUploading(false); }
  }
  const needPlan = (what) => flash(`${what} is available on OUT+ and OUT PRO. Upgrade from your profile.`);
  const startVoice = () => (perks?.voiceNotes ? setRecording(true) : needPlan("Voice notes"));
  const pickFile = () => (perks?.fileSharing ? fileRef.current?.click() : needPlan("File sharing"));
  const onFile = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (perks?.fileMaxMB && f.size > perks.fileMaxMB * 1048576) return flash(`That file is over your ${perks.fileMaxMB} MB limit.`); upload(f, "file", 0, f.name); };
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.innerWidth >= 768) { e.preventDefault(); send(); } if (e.key === "Escape") { setReplyTo(null); setEditing(null); } };

  async function react(m, emoji) { try { merge([await api.reactDm(m.id, emoji)]); } catch (e) { flash(e.message); } }
  async function del(m) { try { await api.deleteDm(m.id); merge([{ ...m, deleted: true, text: "" }]); } catch (e) { flash(e.message); } }
  function jumpTo(mid) { const el = document.getElementById(`m-${mid}`); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); setHighlight(mid); setTimeout(() => setHighlight(null), 1400); } }
  const startReply = (m) => { setEditing(null); setReplyTo(m); inputRef.current?.focus(); };
  const startEdit = (m) => { setReplyTo(null); setEditing(m); setText(m.text); setTimeout(() => inputRef.current?.focus(), 0); };

  async function respond(action) {
    try { await api.respondToRequest(id, action); if (action === "accept") { load(true); } else router.push("/messages"); }
    catch (e) { flash(e.message); }
  }
  async function setSetting(changes, okMsg) { try { await api.updateConversation(id, changes); setConv((c) => ({ ...c, ...("muted" in changes ? { muted: changes.muted } : {}), ...("ttlSeconds" in changes ? { ttlSeconds: changes.ttlSeconds } : {}) })); if (okMsg) flash(okMsg); } catch (e) { flash(e.message); } }

  const items = useMemo(() => {
    const out = []; let lastDay = null, prev = null;
    for (const m of msgs) {
      const d = dayLabel(m.createdAt);
      if (d !== lastDay) { out.push({ sep: d }); lastDay = d; prev = null; }
      out.push({ m, grouped: prev && prev.mine === m.mine && new Date(m.createdAt) - new Date(prev.createdAt) < 120000 });
      prev = m;
    }
    return out;
  }, [msgs]);

  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!conv) return <Loading />;

  const canSend = conv.status === "active" && !conv.blocked;
  const waiting = conv.status === "pending" && conv.iAmInitiator;

  return (
    <div className="flex flex-col" style={{ flex: 1, minHeight: 0, background: C.ink, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", position: "relative", boxShadow: "var(--lo-shadow-1)" }}>
      {/* header */}
      <div className="flex items-center gap-3" style={{ padding: "12px 14px", background: C.surface, borderBottom: `1px solid ${C.line}` }}>
        <Link href="/messages" className="md:hidden" aria-label="Back" style={{ color: C.muted, display: "flex" }}><ChevronLeft size={22} /></Link>
        <Link href={`/u/${conv.other.handle}`} className="flex items-center gap-3" style={{ textDecoration: "none", minWidth: 0, flex: 1 }}>
          <Avatar src={conv.other.avatarUrl} label={conv.other.displayLabel} size={40} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.other.displayLabel}</div>
            <div style={{ ...monoFont, fontSize: 12, color: conv.otherTyping ? C.mustard : C.muted, display: "flex", alignItems: "center", gap: 6 }}>
              {conv.otherTyping ? "typing…" : conv.status === "pending" ? "Message request" : "Private alias chat"}
              {conv.ttlSeconds > 0 && <span className="flex items-center gap-1"><Timer size={10} /> {conv.ttlSeconds === 86400 ? "24h" : "7d"}</span>}
              {conv.muted && <BellOff size={10} />}
            </div>
          </div>
        </Link>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenu(!menu)} aria-label="Chat options" style={iconBtn()}><MoreVertical size={18} /></button>
          {menu && (<>
            <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div role="menu" className="lo-toast" style={{ position: "absolute", right: 0, top: "100%", zIndex: 41, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 12px 32px rgba(0,0,0,.35)", padding: 4, minWidth: 210 }}>
              <MenuItem icon={conv.muted ? Bell : BellOff} label={conv.muted ? "Unmute notifications" : "Mute notifications"} onClick={() => { setMenu(false); setSetting({ muted: !conv.muted }, conv.muted ? "Unmuted" : "Muted"); }} />
              <MenuItem icon={Archive} label="Archive chat" onClick={async () => { setMenu(false); await setSetting({ archived: true }); router.push("/messages"); }} />
              {conv.status === "active" && <MenuItem icon={Timer} label="Disappearing messages" onClick={() => { setMenu(false); setSheet("timer"); }} />}
              <MenuItem icon={Flag} label="Report" onClick={() => { setMenu(false); setSheet("report"); }} />
              <MenuItem icon={Ban} label={conv.blocked ? "Unblock" : "Block"} danger onClick={async () => { setMenu(false); try { conv.blocked ? await api.unblockHandle(conv.other.handle) : await api.blockHandle(conv.other.handle); load(true); flash(conv.blocked ? "Unblocked" : "Blocked"); } catch (e) { flash(e.message); } }} />
              <MenuItem icon={Trash2} label="Delete chat (for me)" danger onClick={() => { setMenu(false); setSheet("delete"); }} />
            </div>
          </>)}
        </div>
      </div>

      {notice && <div className="lo-toast" style={{ position: "absolute", top: 62, left: "50%", transform: "translateX(-50%)", zIndex: 30, ...monoFont, fontSize: 12, color: C.text, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 14px", boxShadow: "0 6px 20px rgba(0,0,0,.3)" }}>{notice}</div>}

      {/* messages */}
      <div ref={scroller} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 14px 14px", overscrollBehavior: "contain" }}>
        <div className="flex items-center justify-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.muted, background: alpha(C.mustard, 8), border: `1px solid ${alpha(C.mustard, 22)}`, borderRadius: 10, padding: "6px 10px", margin: "6px auto 4px", maxWidth: 380, textAlign: "center" }}>
          <Lock size={11} style={{ flexShrink: 0 }} /> Messages are encrypted at rest. You're chatting as an alias — no real names are shared.
        </div>
        {hasMore && <div style={{ textAlign: "center" }}><button onClick={loadOlder} style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "none", border: "none", cursor: "pointer", padding: 8 }}>Load earlier messages</button></div>}
        {items.map((it, i) => it.sep
          ? <div key={"s" + i} style={{ textAlign: "center", margin: "14px 0 4px" }}><span style={{ ...monoFont, fontSize: 12, color: C.muted, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: "3px 10px" }}>{it.sep}</span></div>
          : <Bubble key={it.m.id} m={it.m} grouped={it.grouped} readAt={conv.otherLastReadAt} highlight={highlight === it.m.id} jumpTo={jumpTo}
              onReply={startReply} onReact={react} onEdit={startEdit} onDelete={del} onCopy={(m) => navigator.clipboard?.writeText(m.text).then(() => flash("Copied"))} />)}
        {conv.otherTyping && (
          <div style={{ display: "flex", marginTop: 10 }}><div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, borderBottomLeftRadius: 6, padding: "10px 14px", display: "flex", gap: 4 }} aria-label="typing">
            {[0, 1, 2].map((d) => <span key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: C.muted, animation: `lo-typing 1.1s ${d * 0.16}s infinite ease-in-out` }} />)}
          </div></div>
        )}
        {waiting && <div style={{ ...monoFont, fontSize: 12, color: C.muted, textAlign: "center", margin: "18px 8px" }}>Your request was sent. You can message once they accept.</div>}
      </div>

      {!atBottom && <button onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })} aria-label="Jump to latest" className="lo-tap" style={{ position: "absolute", right: 16, bottom: 86, width: 36, height: 36, borderRadius: "50%", background: C.surface, border: `1px solid ${C.line}`, color: C.text, cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.3)" }}>↓</button>}

      {/* request gate / composer */}
      {conv.awaitingMyResponse ? (
        <div style={{ background: C.surface, borderTop: `1px solid ${C.line}`, padding: 14 }} className="flex flex-col gap-2.5">
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}><b>{conv.other.displayLabel}</b> wants to message you. They can't send more until you accept, and they won't be told if you decline.</div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => respond("accept")} className="lo-btn lo-btn-primary lo-btn-sm">Accept</button>
            <button onClick={() => respond("decline")} className="lo-btn lo-btn-secondary lo-btn-sm">Decline</button>
            <button onClick={() => respond("block")} className="lo-btn lo-btn-ghost lo-btn-sm" style={{ color: C.flag }}>Block</button>
          </div>
        </div>
      ) : !canSend ? (
        <div style={{ background: C.surface, borderTop: `1px solid ${C.line}`, padding: 14, ...monoFont, fontSize: 12, color: C.muted, textAlign: "center" }}>{conv.blocked ? "You blocked this person. Unblock them from the menu to chat." : waiting ? "Waiting for them to accept your request." : "You can't message this person."}</div>
      ) : (
        <div style={{ background: C.surface, borderTop: `1px solid ${C.line}` }}>
          {(replyTo || editing) && (
            <div className="flex items-center gap-2" style={{ padding: "8px 12px", borderBottom: `1px solid ${C.line}`, background: C.surface2 }}>
              <div style={{ borderLeft: `3px solid ${C.mustard}`, paddingLeft: 8, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.mustard }}>{editing ? "Editing message" : `Replying to ${replyTo.mine ? "yourself" : conv.other.displayLabel}`}</div>
                <div style={{ fontSize: 12.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(editing || replyTo).text}</div>
              </div>
              <button onClick={() => { setReplyTo(null); setEditing(null); if (editing) setText(""); }} aria-label="Cancel" style={iconBtn()}><X size={16} /></button>
            </div>
          )}
          {gifOpen && <div style={{ padding: 10, borderBottom: `1px solid ${C.line}` }}><GifPicker onSelect={(url) => { setGifOpen(false); sendRich({ type: "sticker", url }); }} onClose={() => setGifOpen(false)} /></div>}
          {emoji && <div style={{ padding: 10, borderBottom: `1px solid ${C.line}` }}><EmojiGrid autoFocus={false} onPick={(e) => { setText((t) => t + e); inputRef.current?.focus(); }} /></div>}
          {recording ? <VoiceRecorder maxSeconds={perks?.voiceNoteMaxSeconds || 180} onCancel={() => setRecording(false)} onSend={(blob, secs, type) => { setRecording(false); upload(new File([blob], "voice-note", { type }), "voice", secs); }} /> : (
          <div data-kb="chat" className="flex items-end gap-2" style={{ padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))" }}>
            <input ref={fileRef} type="file" hidden onChange={onFile} />
            <button onClick={() => { setGifOpen(!gifOpen); setEmoji(false); }} aria-label="Stickers and GIFs" aria-pressed={gifOpen} className="lo-tap" style={{ ...iconBtn(), color: gifOpen ? C.mustard : C.muted, padding: 8 }}><Sticker size={20} /></button>
            <button onClick={pickFile} disabled={uploading} aria-label="Attach a file" className="lo-tap" style={{ ...iconBtn(), color: C.muted, padding: 8, opacity: perks?.fileSharing ? 1 : 0.55 }}><Paperclip size={20} /></button>
            <button onClick={() => { setEmoji(!emoji); setGifOpen(false); }} aria-label="Emoji" aria-pressed={emoji} className="lo-tap" style={{ ...iconBtn(), color: emoji ? C.mustard : C.muted, padding: 8 }}><Smile size={20} /></button>
            <textarea ref={inputRef} value={text} onChange={(e) => onType(e.target.value)} onKeyDown={onKey} rows={1} maxLength={perks?.maxLen || 4000} placeholder="Write a message" aria-label="Message"
              style={{ flex: 1, resize: "none", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 22, padding: "10px 16px", color: C.text, fontSize: 15, outline: "none", maxHeight: 140, lineHeight: 1.4 }} />
            <button onClick={text.trim() || editing ? send : startVoice} disabled={uploading} aria-label={text.trim() || editing ? "Send" : "Record a voice note"} className="lo-tap" style={{ width: 42, height: 42, borderRadius: "50%", background: "var(--lo-grad)", color: "#fff", border: "none", cursor: "pointer", opacity: text.trim() || perks?.voiceNotes ? 1 : 0.6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{editing ? <Check size={18} /> : text.trim() ? <Send size={17} /> : <Mic size={18} />}</button>
          </div>)}
        </div>
      )}

      {sheet && <ChatSheet kind={sheet} conv={conv} onClose={() => setSheet(null)} onDone={(m, leave) => { setSheet(null); if (m) flash(m); if (leave) router.push("/messages"); else load(true); }} />}
    </div>
  );
}

function ChatSheet({ kind, conv, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const run = async (fn, msg, leave) => { setBusy(true); setErr(null); try { await fn(); onDone(msg, leave); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" className="lo-toast" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: 480, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        {kind === "timer" && (<>
          <div style={{ ...displayFont, fontSize: 16, color: C.text }}>Disappearing messages</div>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>New messages in this chat are permanently erased after the chosen time. Applies to both of you.</p>
          {TTLS.map(([v, l]) => <button key={v} onClick={() => run(() => api.updateConversation(conv.id, { ttlSeconds: v }), `Timer: ${l}`)} style={{ textAlign: "left", background: conv.ttlSeconds === v ? alpha(C.mustard, 14) : "none", border: `1px solid ${conv.ttlSeconds === v ? C.mustard : C.line}`, borderRadius: 12, padding: "10px 14px", color: C.text, cursor: "pointer", fontSize: 14 }}>{l}</button>)}
        </>)}
        {kind === "report" && (<>
          <div style={{ ...displayFont, fontSize: 16, color: C.text }}>Report {conv.other.displayLabel}</div>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>The last 10 messages are shared with a reviewer as evidence. They're not shared with the other person, and they're blocked automatically.</p>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13.5 }}><option value="">Choose a reason…</option>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={1000} placeholder="Anything else we should know? (optional)" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, resize: "none" }} />
          <button disabled={!reason || busy} onClick={() => run(() => api.reportConversation(conv.id, { reason, details }), "Reported and blocked.", true)} className="lo-btn lo-btn-danger">Submit report</button>
        </>)}
        {kind === "delete" && (<>
          <div style={{ ...displayFont, fontSize: 16, color: C.text }}>Delete this chat?</div>
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>Removes the conversation for you only. {conv.other.displayLabel} keeps their copy.</p>
          <button disabled={busy} onClick={() => run(() => api.clearConversation(conv.id), "Chat deleted.", true)} className="lo-btn lo-btn-danger">Delete for me</button>
        </>)}
        {err && <ErrorNote>{err}</ErrorNote>}
        <button onClick={onClose} className="lo-btn lo-btn-ghost lo-btn-sm">Cancel</button>
      </div>
    </div>
  );
}
