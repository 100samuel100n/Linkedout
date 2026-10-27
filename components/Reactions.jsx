"use client";
import Loading from "@/components/ui/Loading";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Heart, Search, X, Keyboard } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { fmt } from "@/lib/format";
import { useDialog } from "@/components/Dialog";
import { api } from "@/lib/api";
import { EMOJI_CATEGORIES, FREQUENT } from "@/lib/emoji-data";

export const LIKE = "❤️";
const QUICK = ["😂", "😩", "💀", "🚩", "🔥"]; // post reactions — the heart is a Like now, not a reaction
const RECENT_KEY = "lo-recent-emoji";

function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } }
function pushRecent(e) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...loadRecent().filter((x) => x !== e)].slice(0, 24))); } catch { /* ignore */ }
}

// Accepts exactly one emoji typed/pasted via the device's own emoji keyboard.
function singleEmoji(text) {
  const t = (text || "").trim();
  if (!t) return null;
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(t)] : [t];
  const last = seg[seg.length - 1]?.segment || "";
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(last) ? last : null;
}

// ---- The full emoji list (search, categories, recents, keyboard input) ----
export function EmojiGrid({ onPick, autoFocus = true }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("recent");
  const [typed, setTyped] = useState("");
  const [recent, setRecent] = useState([]);
  useEffect(() => { setRecent(loadRecent()); }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    const out = [];
    for (const c of EMOJI_CATEGORIES) for (const [e, name] of c.emoji) if (name.includes(term)) out.push(e);
    return out.slice(0, 120);
  }, [q]);

  const tabs = [{ id: "recent", label: "🕘" }, ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.emoji[0][0], title: c.label }))];
  const list = results
    ? results
    : cat === "recent"
      ? [...new Set([...recent, ...FREQUENT])]
      : EMOJI_CATEGORIES.find((c) => c.id === cat)?.emoji.map((x) => x[0]) || [];

  function pick(e) { pushRecent(e); onPick(e); }

  return (
    <div className="flex flex-col gap-2" style={{ minHeight: 0 }}>
      <div className="flex items-center gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "6px 10px" }}>
        <Search size={13} color={C.muted} />
        <input
          autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji (e.g. fire, laugh, heart)"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 12.5, minWidth: 0 }}
        />
        {q && <button onClick={() => setQ("")} aria-label="Clear" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", display: "flex" }}><X size={13} /></button>}
      </div>
      {!results && (
        <div className="flex gap-1" style={{ overflowX: "auto" }}>
          {tabs.map((t) => (
            <button key={t.id} title={t.title || "Recent"} onClick={() => setCat(t.id)} className="lo-tap"
              style={{ fontSize: 16, padding: "3px 7px", borderRadius: 8, cursor: "pointer", background: cat === t.id ? alpha(C.mustard, 16) : "transparent", border: `1px solid ${cat === t.id ? alpha(C.mustard, 45) : "transparent"}` }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ overflowY: "auto", maxHeight: 210, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2, alignContent: "start" }}>
        {list.length === 0 && <div style={{ gridColumn: "1 / -1", ...monoFont, fontSize: 12, color: C.muted, padding: 10 }}>No matches — try the keyboard box below.</div>}
        {list.map((e) => (
          <button key={e} onClick={() => pick(e)} className="lo-tap" style={{ fontSize: 21, background: "none", border: "none", borderRadius: 8, padding: 3, cursor: "pointer", lineHeight: 1.2 }}>{e}</button>
        ))}
      </div>
      <div className="flex items-center gap-2" style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
        <Keyboard size={13} color={C.muted} />
        <input
          value={typed}
          onChange={(e) => { const em = singleEmoji(e.target.value); setTyped(e.target.value); if (em) { pick(em); setTyped(""); } }}
          placeholder="Use your keyboard's emoji…" inputMode="text"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 12, minWidth: 0 }}
        />
      </div>
    </div>
  );
}

// ---- Popover: quick reactions + expandable full list ----
export function ReactionPopover({ anchorRef, onPick, onClose, startExpanded = false, current = null, quick = QUICK }) {
  const [expanded, setExpanded] = useState(startExpanded);
  const [pos, setPos] = useState(null);
  const [mobile, setMobile] = useState(false);

  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    setMobile(vw < 640);
    if (!r) return;
    const width = Math.min(330, vw - 16);
    let left = Math.min(Math.max(8, r.left), vw - width - 8);
    const spaceBelow = vh - r.bottom;
    const needed = expanded ? 340 : 60;
    const top = spaceBelow > needed + 12 ? r.bottom + 8 : Math.max(8, r.top - needed - 8);
    setPos({ left, top, width });
  }, [anchorRef, expanded]);

  useEffect(() => {
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const key = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("keydown", key); };
  }, [place, onClose]);

  if (!pos) return null;
  const box = mobile
    ? { position: "fixed", left: 0, right: 0, bottom: 0, borderRadius: "18px 18px 0 0", padding: "14px 14px calc(14px + env(safe-area-inset-bottom, 0px))" }
    : { position: "fixed", left: pos.left, top: pos.top, width: pos.width, borderRadius: 16, padding: 10 };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: mobile ? "rgba(0,0,0,.4)" : "transparent" }} />
      <div role="dialog" aria-label="Choose a reaction" className="lo-toast" style={{ ...box, zIndex: 81, background: C.surface, border: `1px solid ${C.line}`, boxShadow: "0 18px 50px rgba(0,0,0,.4)" }}>
        {!expanded ? (
          <div className="flex items-center gap-1" style={{ justifyContent: "space-between" }}>
            {quick.map((e) => (
              <button key={e} onClick={() => onPick(e)} className="lo-tap" aria-label={`React ${e}`}
                style={{ fontSize: 24, background: current === e ? alpha(C.mustard, 18) : "none", border: "none", borderRadius: 12, padding: "5px 7px", cursor: "pointer", transition: "transform .12s" }}
                onMouseEnter={(ev) => (ev.currentTarget.style.transform = "scale(1.25)")} onMouseLeave={(ev) => (ev.currentTarget.style.transform = "scale(1)")}>{e}</button>
            ))}
            <button onClick={() => setExpanded(true)} aria-label="More reactions" className="lo-tap"
              style={{ width: 34, height: 34, borderRadius: "50%", background: C.surface2, border: `1px solid ${C.line}`, color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>＋</button>
          </div>
        ) : (
          <EmojiGrid onPick={onPick} />
        )}
      </div>
    </>,
    document.body
  );
}

// ---- Summary chip row: top emoji + total ----
export function ReactionSummary({ reactions, mine }) {
  if (!reactions || reactions.total <= 0) return null;
  return (
    <div className="flex items-center gap-2" style={{ minHeight: 22 }} aria-label={`${reactions.total} reactions`}>
      <div className="flex" style={{ paddingLeft: 4 }}>
        {reactions.top.map(([e], i) => (
          <span key={e} style={{ marginLeft: i ? -5 : 0, width: 22, height: 22, borderRadius: "50%", background: C.surface2, border: `2px solid ${C.surface}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, zIndex: 10 - i }}>{e}</span>
        ))}
      </div>
      <span style={{ ...monoFont, fontSize: 12, color: mine ? C.text : C.muted }}>{fmt(reactions.total)}</span>
    </div>
  );
}

// ---- Like: its own button, its own count (separate from emoji reactions) ----
// Responds on the same frame: state flips immediately, the request runs in the
// background (idempotent {on}), and a rapid second tap just supersedes the first.
export function LikeButton({ postId, liked: l0, count: c0, kind = "post", compact = false }) {
  const dialog = useDialog();
  const [liked, setLiked] = useState(!!l0), [count, setCount] = useState(c0 || 0);
  const seq = useRef(0), pending = useRef(0), settled = useRef({ liked: !!l0, count: c0 || 0 });
  useEffect(() => { if (!pending.current) { setLiked(!!l0); setCount(c0 || 0); settled.current = { liked: !!l0, count: c0 || 0 }; } }, [l0, c0]);

  function tap(e) {
    e?.stopPropagation();
    const next = !liked, my = ++seq.current;
    setLiked(next); setCount((n) => Math.max(0, n + (next ? 1 : -1)));
    pending.current++;
    (kind === "comment" ? api.likeComment : api.likePost)(postId, next)
      .then((r) => { settled.current = { liked: r.liked, count: r.likeCount }; if (my === seq.current) { setLiked(r.liked); setCount(r.likeCount); } })
      .catch((err) => { if (my === seq.current) { setLiked(settled.current.liked); setCount(settled.current.count); } dialog.toast(err.status === 401 ? "Log in to like posts." : err.message); })
      .finally(() => { pending.current--; });
  }
  return (
    <button onClick={tap} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} title="Like" className="lo-act"
      style={{ color: liked ? "#E0245E" : C.muted, ...(compact ? { minWidth: 28, minHeight: 24, padding: "0 4px" } : null) }}>
      <span className={liked ? "lo-pop" : undefined} style={{ display: "flex" }} key={liked ? "on" : "off"}><Heart size={compact ? 14 : 16} fill={liked ? "currentColor" : "none"} /></span>
      {count > 0 && <span style={{ ...monoFont, fontSize: 12 }}>{fmt(count)}</span>}
    </button>
  );
}

// ---- Full breakdown sheet: every emoji with its count (scrolls) ----
function ReactionBreakdown({ kind, id, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.getReactionBreakdown(kind, id).then(setData).catch(() => setData({ total: 0, all: [] })); }, [kind, id]);
  useEffect(() => { const k = (e) => e.key === "Escape" && onClose(); document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k); }, [onClose]);
  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.45)" }} />
      <div role="dialog" aria-label="All reactions" className="lo-toast" style={{ position: "fixed", zIndex: 81, left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(340px, calc(100vw - 24px))", maxHeight: "60vh", display: "flex", flexDirection: "column", background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 18px 50px rgba(0,0,0,.4)" }}>
        <div className="flex items-center justify-between" style={{ padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>Reactions{data ? ` · ${fmt(data.total)}` : ""}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", display: "flex" }}><X size={16} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 6 }}>
          {!data && <Loading />}
          {data?.all.map(([e, n]) => (
            <div key={e} className="flex items-center justify-center gap-1.5" style={{ background: C.surface2, borderRadius: 10, padding: "6px 8px" }}>
              <span style={{ fontSize: 17 }}>{e}</span><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{fmt(n)}</span>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}

const MAX_CHIPS = 3; // only the top few emoji are listed; the rest collapse into one "+N" chip

// ---- Reactions: top emoji chips, one overflow chip, one "＋" ----
// kind: "post" | "comment". Optimistic and instant; requests are chained so
// they reach the server in tap order, and the server's answer settles the UI.
export default function ReactionControl({ kind = "post", id, reactions: initial, myReaction: initialMine, compact = false, onChange }) {
  const dialog = useDialog();
  const [reactions, setReactions] = useState(initial || { total: 0, top: [] });
  const [mine, setMine] = useState(initialMine || null);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const anchor = useRef(null), chain = useRef(Promise.resolve()), pending = useRef(0), cur = useRef({ reactions, mine });
  cur.current = { reactions, mine };

  useEffect(() => { if (!pending.current) { setReactions(initial || { total: 0, top: [] }); setMine(initialMine || null); } }, [initial, initialMine]);

  const send = useCallback((emoji) => {
    setOpen(false);
    const { reactions: rs, mine: m } = cur.current;
    const map = new Map(rs.top); let total = rs.total;
    if (m) { map.set(m, Math.max(0, (map.get(m) || 1) - 1)); total -= 1; }
    if (m !== emoji) { map.set(emoji, (map.get(emoji) || 0) + 1); total += 1; }
    const top = [...map.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const prev = { reactions: rs, mine: m };
    setReactions({ total: Math.max(0, total), kinds: Math.max(top.length, rs.kinds || 0), top }); setMine(m === emoji ? null : emoji);
    pending.current++;
    chain.current = chain.current.then(async () => {
      try {
        const res = kind === "post" ? await api.reactToPost(id, emoji) : await api.reactToComment(id, emoji);
        if (pending.current === 1) { setReactions(res.reactions); setMine(res.myReaction ?? null); }
        onChange?.(res);
      } catch (e) {
        setReactions(prev.reactions); setMine(prev.mine);
        dialog.toast(e.status === 401 ? "Log in to react." : e.message);
      } finally { pending.current--; }
    });
  }, [kind, id, onChange, dialog]);

  // Chips: top MAX_CHIPS, but always surface the viewer's own reaction if it is in the loaded top set.
  let chips = reactions.top.slice(0, MAX_CHIPS);
  if (mine && !chips.some(([e]) => e === mine)) {
    const mineEntry = reactions.top.find(([e]) => e === mine);
    if (mineEntry) chips = [...chips.slice(0, MAX_CHIPS - 1), mineEntry];
  }
  const shown = chips.reduce((a, [, n]) => a + n, 0);
  const restCount = Math.max(0, reactions.total - shown);
  const chipPad = compact ? "1px 7px" : "2px 9px";

  return (
    <div className="flex items-center flex-wrap" style={{ gap: 6, minWidth: 0 }} ref={anchor}>
      {chips.map(([e, n]) => (
        <button key={e} onClick={() => send(e)} aria-pressed={mine === e} aria-label={`${e} ${n}`} className="lo-chip"
          style={{ background: mine === e ? alpha(C.mustard, 20) : "transparent", border: `1px solid ${mine === e ? alpha(C.mustard, 55) : C.line}`, padding: chipPad }}>
          <span style={{ fontSize: compact ? 13 : 15, lineHeight: 1 }}>{e}</span><span style={{ ...monoFont, fontSize: 12, color: mine === e ? C.text : C.muted }}>{fmt(n)}</span>
        </button>
      ))}
      {restCount > 0 && (
        <button onClick={() => setShowAll(true)} aria-label={`${fmt(restCount)} more reactions — see all`} title="See all reactions" className="lo-chip"
          style={{ border: `1px solid ${C.line}`, color: C.muted, padding: chipPad }}>
          <span style={{ ...monoFont, fontSize: 12 }}>+{fmt(restCount)}</span>
        </button>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label="Add reaction" title="Add reaction" className="lo-chip"
        style={{ border: `1px solid ${C.line}`, color: C.muted, width: compact ? 26 : 30, height: compact ? 22 : 26, justifyContent: "center", fontSize: 16, padding: 0 }}>＋</button>
      {open && <ReactionPopover anchorRef={anchor} onPick={send} onClose={() => setOpen(false)} current={mine} quick={QUICK} />}
      {showAll && <ReactionBreakdown kind={kind} id={id} onClose={() => setShowAll(false)} />}
    </div>
  );
}
