"use client";
import Loading from "@/components/ui/Loading";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, MailQuestion, Archive, BellOff, Search, BarChart3, Zap } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { useNotifications } from "@/app/notifications-provider";

export function Avatar({ src, label, size = 44 }) {
  return src
    ? <img src={src} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: "50%", background: C.surface2, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>{(label || "?")[0]?.toUpperCase()}</div>;
}

export function shortTime(iso) {
  const d = new Date(iso), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const diff = (n - d) / 864e5;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const TABS = [
  { key: "inbox", label: "Chats", icon: Inbox },
  { key: "requests", label: "Requests", icon: MailQuestion },
  { key: "archived", label: "Archived", icon: Archive },
];

export default function ConversationList() {
  const { user } = useAuth();
  const { setMessageUnread } = useNotifications();
  const pathname = usePathname();
  const [box, setBox] = useState("inbox");
  const [items, setItems] = useState(null);
  const [requestCount, setRequestCount] = useState(0);
  const [q, setQ] = useState("");
  const activeId = pathname.split("/")[2];

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [list, sum] = await Promise.all([api.getConversations(box), api.getUnreadMessages()]);
      setItems(list); setRequestCount(sum.requests || 0); setMessageUnread(sum.total || 0);
    } catch { /* retried on next tick */ }
  }, [user, box, setMessageUnread]);

  useEffect(() => {
    setItems(null); load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 6000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  // Refresh immediately when the open chat changes (read state, new chat).
  useEffect(() => { load(); }, [pathname]); // eslint-disable-line

  const term = q.trim().toLowerCase();
  const shown = (items || []).filter((c) => !term || c.other.displayLabel.toLowerCase().includes(term));

  return (
    <div className="flex flex-col" style={{ height: "100%", minHeight: 0 }}>
      <div className="flex items-center justify-between" style={{ padding: "2px 4px 12px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 750, letterSpacing: "-0.02em", color: C.text }}>Messages</h1>
        <Link href="/messages/analytics" aria-label="Message analytics" title="Message analytics" className="lo-btn lo-btn-ghost lo-btn-sm" style={{ textDecoration: "none", padding: "0 10px" }}><BarChart3 size={17} /></Link>
      </div>
      <div className="flex items-center gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "9px 14px", marginBottom: 12 }}>
        <Search size={16} color={C.muted} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 14.5, minWidth: 0 }} />
      </div>
      <div className="lo-tabs" style={{ marginBottom: 10, alignSelf: "stretch" }} role="tablist">
        {TABS.map((t) => {
          const active = box === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={active} onClick={() => setBox(t.key)} className="lo-tab flex items-center justify-center gap-1.5" style={{ flex: 1 }}>
              {t.label}
              {t.key === "requests" && requestCount > 0 && <span style={{ background: C.mustard, color: "#fff", borderRadius: 10, fontSize: 12, fontWeight: 700, padding: "0 6px", minWidth: 18, textAlign: "center" }}>{requestCount}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0, margin: "0 -4px" }}>
        {items === null && <Loading variant="list" rows={6} />}
        {items && shown.length === 0 && (
          <EmptyState compact icon={box === "requests" ? MailQuestion : box === "archived" ? Archive : Inbox}
            title={box === "requests" ? "No message requests" : box === "archived" ? "Nothing archived" : "No conversations yet"}>
            {box === "inbox" ? "Open someone's profile and tap Message to send a request." : box === "requests" ? "When someone asks to message you, it shows up here first." : "Archived chats are kept here."}
          </EmptyState>
        )}
        {shown.map((c) => {
          const active = c.id === activeId;
          return (
            <Link key={c.id} href={`/messages/${c.id}`} className="flex items-center gap-3 lo-row-hover"
              style={{ padding: "11px 10px", borderRadius: 12, textDecoration: "none", background: active ? "var(--lo-accent-soft)" : undefined }}>
              <Avatar src={c.other.avatarUrl} label={c.other.displayLabel} size={46} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 15, color: C.text, fontWeight: c.unread ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.other.displayLabel}</span>
                  {c.priority && <span className="lo-badge lo-badge-accent" style={{ flexShrink: 0 }}><Zap size={11} /> Priority</span>}
                  <span style={{ ...monoFont, fontSize: 12, color: c.unread ? C.mustard : C.muted, flexShrink: 0 }}>{c.lastMessage ? shortTime(c.lastMessage.createdAt) : ""}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span style={{ fontSize: 13.5, color: c.unread ? C.text : C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: c.lastMessage?.deleted ? "italic" : "normal" }}>
                    {c.requestSentByMe ? "Request sent · waiting for a reply" : c.lastMessage?.deleted ? "Message deleted" : `${c.lastMessage?.mine ? "You: " : ""}${c.lastMessage?.text || ""}`}
                  </span>
                  <span className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
                    {c.muted && <BellOff size={12} color={C.muted} />}
                    {c.unread > 0 && <span style={{ background: C.mustard, color: "#fff", borderRadius: 10, fontSize: 12, fontWeight: 700, minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{c.unread > 99 ? "99+" : c.unread}</span>}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
