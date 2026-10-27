"use client";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import OfflineBanner from "@/components/OfflineBanner";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home, Building2, Briefcase, User, Search, Mic, Trophy, LogOut, Bell,
  Radio, BookOpen, TrendingDown, Users, Languages, PenSquare, Mail, Settings, MoreHorizontal, MessageCircle, UserPlus, BadgeCheck, ShieldAlert, PenLine,
} from "lucide-react";
import { C, displayFont, monoFont, alpha, grainDot, sunken } from "@/lib/theme";
import { PulseDot } from "@/components/primitives";
import { useAuth } from "@/app/auth-provider";
import { useNotifications } from "@/app/notifications-provider";
import { useComposer } from "@/app/composer-provider";
import { usePosts } from "@/app/providers";
import { playSound } from "@/lib/sounds";
import { api } from "@/lib/api";
import { useDialog } from "@/components/Dialog";
import LegalLinks from "@/components/LegalLinks";
import PlayStoreSoon from "@/components/PlayStoreSoon";
import PresenceBeacon from "@/components/PresenceBeacon";
import Logo from "@/components/Logo";

// One logout path for every button: ask first (same wording as the app), then sign out.
function useConfirmLogout() {
  const { logout } = useAuth();
  const dialog = useDialog();
  const router = useRouter();
  return useCallback(async () => {
    const ok = await dialog.confirm({ title: "Log out?", message: "You can always log back in.", confirmLabel: "Log out", danger: true });
    if (!ok) return;
    try { await logout(); } finally { router.push("/"); }
  }, [dialog, logout, router]);
}

// Jobs is paused (not deleted) — flip this back to true to bring it back
// in both the sidebar/mobile tabs below and the page itself (see
// app/jobs/page.js, which shows a "paused" notice while this is false).
const JOBS_ENABLED = false;

const NAV_ITEMS = [
  { href: "/", label: "Stories", icon: Home },
  { href: "/my-stories", label: "My stories", icon: PenLine },
  { href: "/pulse", label: "Pulse", icon: Radio },
  { href: "/layoffs", label: "Layoffs", icon: TrendingDown },
  { href: "/search", label: "Search", icon: Search },
  { href: "/companies", label: "Companies", icon: Building2 },
  ...(JOBS_ENABLED ? [{ href: "/jobs", label: "Jobs", icon: Briefcase }] : []),
  { href: "/messages", label: "Messages", icon: Mail },
  { href: "/vent", label: "Vent", icon: Mic },
  { href: "/circles", label: "Circles", icon: Users },
  { href: "/translator", label: "Translator", icon: Languages },
  { href: "/awards", label: "Awards", icon: Trophy },
  { href: "/profile", label: "Profile", icon: User },
];

// Mobile keeps a compact top tab row instead of the full sidebar labels —
// Search gets its own icon in the top bar there instead of a tab slot.
const MOBILE_TABS = NAV_ITEMS.filter((t) => t.href !== "/search");

// The bell opens the full Notifications page (/notifications) rather than a
// pop-up — same idea as the native app's Notifications screen.
function MessagesBadge({ style, inline }) {
  const { messageUnread } = useNotifications();
  if (!messageUnread) return null;
  return (
    <span aria-label={`${messageUnread} unread messages`} style={{ ...(inline ? {} : style), background: C.flag, color: "#fff", fontSize: 12, borderRadius: 20, minWidth: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 3px", ...monoFont }}>
      {messageUnread > 9 ? "9+" : messageUnread}
    </span>
  );
}

function NotificationBell({ variant = "icon" }) {
  const { user } = useAuth();
  const { unreadCount } = useNotifications();
  const pathname = usePathname();
  if (!user) return null;
  const active = pathname === "/notifications";

  const badge = unreadCount > 0 && (
    <span style={{
      position: "absolute", top: -4, right: -6, background: C.flag, color: "#fff", fontSize: 12, borderRadius: 20,
      minWidth: 15, height: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", ...monoFont,
    }}>
      {unreadCount > 9 ? "9+" : unreadCount}
    </span>
  );

  if (variant === "sidebar") {
    return (
      <Link
        href="/notifications"
        className="flex items-center gap-4 w-full lo-tap"
        style={{ padding: "10px 12px", borderRadius: 10, color: active ? C.mustard : C.text2, background: active ? "var(--lo-accent-soft)" : undefined, textDecoration: "none", fontWeight: active ? 650 : 500 }}
        aria-current={active ? "page" : undefined}
      >
        <div style={{ position: "relative" }}><Bell size={22} strokeWidth={active ? 2.2 : 1.8} />{badge}</div>
        <span className="hidden xl:inline" style={{ fontSize: 15.5 }}>Notifications</span>
      </Link>
    );
  }
  return (
    <Link href="/notifications" aria-label="Notifications" style={{ position: "relative", padding: 2, display: "flex" }}>
      <Bell size={19} color={active ? C.mustard : C.muted} />
      {badge}
    </Link>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const confirmLogout = useConfirmLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!user) return null;

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 w-full"
        style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 12px", borderRadius: 10 }}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.pseudonym} style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: C.muted }}>
            {user.pseudonym?.[0]?.toUpperCase() || "?"}
          </div>
        )}
        <div className="hidden xl:flex flex-col items-start" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, color: C.text, fontWeight: 600 }}>{user.pseudonym}</span>
          <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{({ basic: "OUT", plus: "OUT+", pro: "OUT PRO" })[user.premiumTier || "basic"]}</span>
        </div>
        <MoreHorizontal size={16} color={C.muted} className="hidden xl:block" />
      </button>
      {open && (
        <div style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)", width: 220, background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 12, zIndex: 30, boxShadow: "var(--lo-shadow-2)", overflow: "hidden" }}>
          <Link href="/profile" onClick={() => setOpen(false)} style={{ display: "block", padding: "10px 14px", fontSize: 13, color: C.text, textDecoration: "none" }}>View profile</Link>
          <Link href="/my-stories" onClick={() => setOpen(false)} style={{ display: "block", padding: "10px 14px", fontSize: 13, color: C.text, textDecoration: "none", borderTop: `1px solid ${C.line}` }}>My stories &amp; drafts</Link>
          <Link href="/settings" onClick={() => setOpen(false)} style={{ display: "block", padding: "10px 14px", fontSize: 13, color: C.text, textDecoration: "none", borderTop: `1px solid ${C.line}` }}>Settings & Privacy</Link>
          <button
            onClick={() => { setOpen(false); confirmLogout(); }}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 14px", fontSize: 13, color: C.flag, background: "none", border: "none", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}
          >Log out</button>
        </div>
      )}
    </div>
  );
}

// X-style Home: tapping Feed while already on the feed jumps to the top and
// pulls in the newest posts; from any other page it just navigates there
// (and the feed opens at the top).
function useHomeClick(pathname) {
  const { refresh } = usePosts();
  return useCallback((e) => {
    if (pathname !== "/") return;
    e.preventDefault();
    const y = window.scrollY;
    window.scrollTo({ top: 0, behavior: "smooth" });
    playSound("tap");
    // Reload right away if already at the top; otherwise once the scroll lands.
    // Home is the Stories feed: tell it to reload (Pulse posts refresh too, cheaply).
    setTimeout(() => { window.dispatchEvent(new Event("lo:home-refresh")); refresh(); }, y > 40 ? 350 : 0);
  }, [pathname, refresh]);
}

function DesktopSidebar({ pathname, liveRoomCount }) {
  const { user, loading } = useAuth();
  const composer = useComposer();
  const onHome = useHomeClick(pathname);

  return (
    <div className="hidden md:flex flex-col lo-sidebar" style={{ flexShrink: 0, height: "100vh", position: "sticky", top: 0, padding: "12px 8px" }}>
      <div className="flex flex-col gap-2 xl:items-stretch items-center" style={{ flexShrink: 0 }}>
        <Link
          href="/"
          onClick={onHome}
          className="lo-tap"
          style={{ padding: 10, display: "flex", borderRadius: 14 }}
        >
          <Logo size={40} alt="Linkedout" />
        </Link>
        {!loading && user && (pathname.startsWith("/pulse") ? (
          // The quick-post button belongs to Pulse only. Everywhere else the primary action is a Story.
          <button onClick={composer.open} className="lo-side-cta" aria-label="Post to Pulse" title="Post to Pulse">
            <PenSquare size={18} strokeWidth={2.2} /><span className="hidden xl:inline">Post to Pulse</span>
          </button>
        ) : (
          <Link href="/stories/new" className="lo-side-cta" aria-label="Tell your story" title="Tell your story">
            <BookOpen size={18} strokeWidth={2.2} /><span className="hidden xl:inline">Tell your story</span>
          </Link>
        ))}
      </div>

      {/* The nav grows with the product; it scrolls on its own (scrollbar hidden, soft fade at the edges)
          so the logo, primary action and account menu always stay in view. */}
      <nav aria-label="Primary" className="lo-side-scroll flex flex-col gap-1 xl:items-stretch items-center" style={{ flex: 1, minHeight: 0, marginTop: 6 }}>
        {NAV_ITEMS.map((t) => {
          const Icon = t.icon;
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={t.href === "/" ? onHome : undefined}
              className="flex items-center gap-4 xl:justify-start justify-center lo-row-hover"
              aria-current={active ? "page" : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, color: active ? C.mustard : C.text2, background: active ? "var(--lo-accent-soft)" : undefined, textDecoration: "none", fontWeight: active ? 650 : 500, position: "relative" }}
            >
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              <span className="hidden xl:inline" style={{ fontSize: 15.5, whiteSpace: "nowrap" }}>{t.label}</span>
              {t.href === "/vent" && liveRoomCount > 0 && (
                <span style={{ position: "absolute", top: 8, right: 10 }}><PulseDot /></span>
              )}
              {t.href === "/messages" && <MessagesBadge style={{ position: "absolute", top: 4, left: 28 }} />}
            </Link>
          );
        })}
        <NotificationBell variant="sidebar" />

      </nav>

      <div style={{ flexShrink: 0, paddingTop: 8 }}>
        {!loading && (user ? <UserMenu /> : (
          <Link href="/login" style={{ display: "block", textAlign: "center", ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, borderRadius: 10, padding: "10px 8px", textDecoration: "none" }}>
            Log in
          </Link>
        ))}
      </div>
    </div>
  );
}

// "Find people": a plain lookup box, deliberately NOT a recommender. It
// shows nothing until you type at least 2 characters, ranks nothing
// (results are alphabetical), and never suggests anyone — consistent with
// this app's identity-first design, where discovery shouldn't be shaped by
// an algorithm. Collapsed by default since it's a utility, not a core
// surface.
function FindPeople() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [followingSet, setFollowingSet] = useState(new Set());

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      api.search(term).then((r) => setResults(r.people || [])).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function follow(handle) {
    setFollowingSet((s) => new Set(s).add(handle));
    try { await api.followHandle(handle); }
    catch { setFollowingSet((s) => { const next = new Set(s); next.delete(handle); return next; }); }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: open ? 16 : "10px 16px" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, ...monoFont, fontSize: 12, color: C.muted }}
      >
        <span className="flex items-center gap-2"><Search size={13} /> Find people</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3" style={{ marginTop: 10 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by username"
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: "100%" }}
          />
          {results && results.length === 0 && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>No one with that username.</div>}
          {results && results.map((s) => (
            <div key={s.handle} className="flex items-center gap-2">
              <Link href={`/u/${s.handle}`}>
                {s.avatarUrl
                  ? <img src={s.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                  : <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>{s.pseudonym[0]}</div>}
              </Link>
              <Link href={`/u/${s.handle}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", fontSize: 12.5, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.pseudonym}</Link>
              <button
                onClick={() => follow(s.handle)}
                disabled={followingSet.has(s.handle)}
                className="lo-tap"
                style={{ ...monoFont, fontSize: 12, color: followingSet.has(s.handle) ? C.muted : C.mustard, background: "none", border: `1px solid ${followingSet.has(s.handle) ? C.line : alpha(C.mustard, 40)}`, borderRadius: 20, padding: "4px 10px", cursor: followingSet.has(s.handle) ? "default" : "pointer" }}
              >
                {followingSet.has(s.handle) ? "Following" : "Follow"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RightPanel({ liveRoomCount }) {
  const { user } = useAuth();
  return (
    <div className="hidden lg:flex flex-col gap-4" style={{ width: 320, flexShrink: 0, padding: "12px 16px", height: "100vh", position: "sticky", top: 0, overflowY: "auto" }}>
      <Link
        href="/search"
        className="flex items-center gap-2"
        style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "11px 14px", color: C.muted, fontSize: 14, textDecoration: "none" }}
      >
        <Search size={15} /> Search Linkedout
      </Link>

      {user && <FindPeople />}

      {!user?.isPremium && (
        <div style={{ background: C.surface, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 16, padding: 18 }}>
          <div style={{ ...displayFont, fontSize: 15.5, color: C.text, marginBottom: 6 }}>Go OUT+ or OUT PRO</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>No ads, more AI tools, and a seat in Vent Rooms.</div>
          <Link href="/premium" className="lo-btn lo-btn-primary lo-btn-sm" style={{ textDecoration: "none" }}>Upgrade</Link>
        </div>
      )}

      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
        <div style={{ ...displayFont, fontSize: 15.5, color: C.text, marginBottom: 10 }}>Vent Sessions</div>
        {liveRoomCount > 0 ? (
          <Link href="/vent" className="flex items-center gap-2" style={{ fontSize: 13, color: C.text, textDecoration: "none" }}>
            <PulseDot /> {liveRoomCount} room{liveRoomCount === 1 ? "" : "s"} open right now
          </Link>
        ) : (
          <Link href="/vent" className="lo-tap" style={{ display: "block", fontSize: 12.5, color: C.muted, textDecoration: "none" }}>Nothing open right now — <span style={{ color: C.mustard, fontWeight: 600 }}>start one →</span></Link>
        )}
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
        <div style={{ ...displayFont, fontSize: 15.5, color: C.text, marginBottom: 6 }}>Humble Brag Translator</div>
        <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>See your real title in full corporate hype, or decode someone else's humblebrag.</div>
        <Link href="/title-translator" style={{ ...monoFont, fontSize: 12, color: C.corpblue, textDecoration: "none" }}>Try it →</Link>
      </div>

      <PlayStoreSoon />

      <LegalLinks style={{ padding: "0 4px" }} />
    </div>
  );
}

function MobileHeader({ pathname, liveRoomCount }) {
  const { user, loading } = useAuth();
  const onHome = useHomeClick(pathname);

  return (
    <div style={{ borderBottom: `1px solid ${C.line}`, background: C.ink }} className="sticky top-0 z-30 md:hidden">
      <div className="max-w-3xl mx-auto flex items-center justify-between px-4 py-3">
        <Link href="/" onClick={onHome} className="flex items-center gap-2 lo-tap" style={{ ...displayFont, fontSize: 21, fontWeight: 800, color: C.text, textDecoration: "none" }}>
          <Logo size={32} />
          <span>Linkedout</span>
        </Link>
        {/* Messages sits in the middle of the top bar (not in a corner); Pulse took its place in the bottom tabs. */}
        {user && (
          <Link href="/messages" aria-label="Messages" title="Messages" className="lo-tap" style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 12, border: `1px solid ${pathname.startsWith("/messages") ? C.mustard : C.line}`, background: pathname.startsWith("/messages") ? alpha(C.mustard, 12) : C.surface }}>
            <Mail size={19} color={pathname.startsWith("/messages") ? C.mustard : C.muted} />
            <MessagesBadge style={{ position: "absolute", top: -5, right: -5 }} />
          </Link>
        )}
        <div className="flex items-center gap-3">
          <Link href="/awards" aria-label="Awards" style={{ display: "flex" }}><Trophy size={19} color={C.muted} /></Link>
          <NotificationBell />
          {loading ? (
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.surface2 }} />
          ) : user ? (
            <>
              {!user.isPremium && (
                <Link href="/premium" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "4px 10px", textDecoration: "none" }}>
                  Upgrade
                </Link>
              )}
            </>
          ) : (
            <Link href="/login" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "5px 12px", textDecoration: "none" }}>
              Log in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// Mobile bottom tab bar: the five primary destinations, always reachable with a thumb.
const BOTTOM_TABS = ["/", "/pulse", "/companies", "/vent", "/profile"].map((h) => NAV_ITEMS.find((t) => t.href === h)).filter(Boolean);
function MobileTabBar({ pathname, liveRoomCount }) {
  const onHome = useHomeClick(pathname);
  return (
    <nav aria-label="Primary" className="md:hidden" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, background: C.surface, borderTop: `1px solid ${C.line}`, paddingBottom: "env(safe-area-inset-bottom, 0px)", boxShadow: "0 -4px 16px rgba(2,6,20,0.18)" }}>
      <div className="max-w-3xl mx-auto flex">
        {BOTTOM_TABS.map((t) => {
          const Icon = t.icon;
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} onClick={t.href === "/" ? onHome : undefined} aria-current={active ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-1" style={{ flex: 1, minHeight: 56, position: "relative", textDecoration: "none", color: active ? C.mustard : C.muted, fontSize: 12, fontWeight: active ? 650 : 500 }}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
                {t.href === "/vent" && liveRoomCount > 0 && <span style={{ position: "absolute", top: -2, right: -6 }}><PulseDot /></span>}
                {t.href === "/messages" && <MessagesBadge style={{ position: "absolute", top: -6, right: -10 }} />}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function Shell({ children }) {
  const pathname = usePathname();
  const [liveRoomCount, setLiveRoomCount] = useState(0);

  // Real count, not a hardcoded number — polled occasionally rather than
  // on every render; a stale-by-a-minute count on a small indicator dot
  // is an acceptable tradeoff for not hitting the API from every page.
  useEffect(() => {
    if (pathname?.startsWith("/admin")) return;
    let cancelled = false;
    async function loadRooms() {
      try {
        const rooms = await api.getRooms();
        if (!cancelled) setLiveRoomCount(rooms.filter((r) => r.live && r.listeners > 0).length);
      } catch {
        // quiet — a nice-to-have indicator, not core functionality
      }
    }
    loadRooms();
    const interval = setInterval(loadRooms, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pathname?.startsWith("/admin")]);

  // The admin dashboard is its own app: no website chrome (sidebar, tabs,
  // composer, right panel) around it. Hooks above still run, so order is stable.
  if (pathname?.startsWith("/admin")) return <><OfflineBanner />{children}</>;

  return (
    <div style={{ background: C.ink, minHeight: "100vh", color: C.text }} className="w-full">
      <OfflineBanner />
      <div
        style={{ backgroundImage: `radial-gradient(circle at 1px 1px, ${grainDot} 1px, transparent 0)`, backgroundSize: "18px 18px" }}
        className="min-h-screen"
      >
        <MobileHeader pathname={pathname} liveRoomCount={liveRoomCount} />
        <MobileTabBar pathname={pathname} liveRoomCount={liveRoomCount} />

        {/* Desktop: X-style three-column layout — fixed nav rail, center
            content column, optional right panel. Mobile falls back to the
            top-bar-plus-tabs header above, sidebar/right panel just don't
            render (hidden via Tailwind breakpoints, not separate code
            paths, so there's one source of truth for nav state). */}
        <PresenceBeacon />
        <div className="max-w-7xl mx-auto flex">
          <DesktopSidebar pathname={pathname} liveRoomCount={liveRoomCount} />
          <div key={pathname} className="lo-route-enter flex-1 min-w-0 px-4 pt-5 pb-24 md:pb-6 md:px-6 max-w-full md:max-w-2xl mx-auto">{children}
            <div className="md:hidden flex flex-col items-center gap-3" style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${C.line}` }}><PlayStoreSoon variant="line" /><LegalLinks style={{ justifyContent: "center" }} /></div>
          </div>
          <RightPanel liveRoomCount={liveRoomCount} />
        </div>
      </div>
    </div>
  );
}
