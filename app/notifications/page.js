"use client";
import Loading from "@/components/ui/Loading";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, MessageCircle, UserPlus, Mic, Trophy, BadgeCheck, ShieldAlert, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { C, monoFont, displayFont, alpha, sunken } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import { useNotifications } from "@/app/notifications-provider";

const CATEGORIES = [
  { key: "all", label: "All", icon: Bell },
  { key: "engagement", label: "Activity", icon: MessageCircle },
  { key: "social", label: "People", icon: UserPlus },
  { key: "messages", label: "Messages", icon: MessageCircle },
  { key: "rooms", label: "Rooms", icon: Mic },
  { key: "achievements", label: "Awards", icon: Trophy },
  { key: "verification", label: "Verification", icon: BadgeCheck },
  { key: "account", label: "Account", icon: ShieldAlert },
];
const ICON = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon]));

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const { notifications, unreadCount, markRead, markAllRead, removeNotifications } = useNotifications();
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState(null);

  const shown = useMemo(() => notifications.filter((n) => filter === "all" || n.category === filter), [notifications, filter]);
  const groups = useMemo(() => {
    const out = [];
    for (const n of shown) {
      const label = dayLabel(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n); else out.push({ label, items: [n] });
    }
    return out;
  }, [shown]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Bell size={28} color={C.muted} />
        <div style={{ ...displayFont, fontSize: 16, color: C.text }}>Log in to see your notifications</div>
        <Link href="/login" style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.mustard, borderRadius: 8, padding: "8px 16px", textDecoration: "none", fontWeight: 700 }}>Log in</Link>
      </div>
    );
  }

  function open(n) {
    if (!n.read) markRead(n.id);
    if (n.relatedPostId) router.push(`/post/${n.relatedPostId}`);
    else if (n.category === "rooms") router.push("/vent");
    else if (n.category === "messages") router.push("/messages");
  }

  async function remove(ids) {
    setError(null);
    try { await removeNotifications(ids); } catch { setError("Couldn't delete that. Check your connection and try again."); }
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 style={{ ...displayFont, fontSize: 22, color: C.text }}>Notifications</h1>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "none", border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
          {shown.length > 0 && (
            <button onClick={() => remove(filter === "all" ? null : shown.map((n) => n.id))} className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer" }}>
              <Trash2 size={13} /> {filter === "all" ? "Clear all" : "Clear these"}
            </button>
          )}
          <Link href="/settings#notifications" aria-label="Notification settings" className="lo-tap" style={{ color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: 7, display: "flex" }}>
            <Settings size={14} />
          </Link>
        </div>
      </div>

      <div className="flex gap-2" style={{ overflowX: "auto", paddingBottom: 2 }} role="tablist">
        {CATEGORIES.map((c) => {
          const active = filter === c.key;
          const n = c.key === "all" ? unreadCount : notifications.filter((x) => x.category === c.key && !x.read).length;
          return (
            <button key={c.key} role="tab" aria-selected={active} onClick={() => setFilter(c.key)} className="lo-tap flex items-center gap-1.5"
              style={{ ...monoFont, fontSize: 12, whiteSpace: "nowrap", cursor: "pointer", color: active ? "#fff" : C.muted, background: active ? C.mustard : "transparent", border: `1px solid ${active ? C.mustard : C.line}`, borderRadius: 999, padding: "6px 12px" }}>
              {c.label}{n > 0 && <span style={{ background: active ? "rgba(255,255,255,.28)" : alpha(C.mustard, 18), color: active ? "#fff" : C.mustard, borderRadius: 999, padding: "0 6px", fontSize: 12 }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {error && <div role="alert" style={{ ...monoFont, fontSize: 12, color: C.flag, background: alpha(C.flag, 10), border: `1px solid ${alpha(C.flag, 35)}`, borderRadius: 10, padding: "9px 12px" }}>{error}</div>}

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-14 text-center" style={{ border: `1px dashed ${C.line}`, borderRadius: 14 }}>
          <Bell size={26} color={C.muted} />
          <div style={{ ...displayFont, fontSize: 15, color: C.text }}>Nothing here yet</div>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Reactions, follows, messages and room activity land here.</div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="flex flex-col gap-2">
            <div style={{ ...monoFont, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>{g.label}</div>
            <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
              {g.items.map((n, i) => {
                const Icon = ICON[n.category] || Bell;
                return (
                  <div key={n.id} style={{ display: "flex", alignItems: "flex-start", background: n.read ? "transparent" : sunken, borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <button onClick={() => open(n)} className="text-left lo-tap"
                    style={{ flex: 1, minWidth: 0, display: "flex", gap: 12, alignItems: "flex-start", padding: "13px 8px 13px 16px", background: "transparent", border: "none", cursor: "pointer" }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: alpha(C.mustard, 12), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={15} color={C.mustard} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, color: C.text, lineHeight: 1.45, overflowWrap: "anywhere" }}>{n.message}</span>
                      <span style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 3, display: "block" }}>{new Date(n.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </span>
                    {!n.read && <span aria-label="unread" style={{ width: 8, height: 8, borderRadius: "50%", background: C.mustard, marginTop: 6, flexShrink: 0 }} />}
                  </button>
                    <button onClick={() => remove([n.id])} aria-label="Delete notification" title="Delete" className="lo-tap" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", padding: "13px 14px", flexShrink: 0 }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
