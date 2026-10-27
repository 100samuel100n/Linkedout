"use client";
import Loading from "@/components/ui/Loading";
import VerifiedTick from "@/components/VerifiedTick";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown, Skull, Sparkles, Camera, UserCog, Grid3x3, Bookmark, Heart, Settings as SettingsIcon, LogOut,
} from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import PostCard from "@/components/PostCard";
import ResumeRoastModal from "@/components/ResumeRoastModal";
import { useAuth } from "@/app/auth-provider";
import { api } from "@/lib/api";
import { useDialog } from "@/components/Dialog";
import ErrorNote from "@/components/ErrorNote";

const TABS = [
  { key: "overview", label: "Overview", icon: UserCog },
  { key: "posts", label: "Posts", icon: Grid3x3 },
  { key: "likes", label: "Likes", icon: Heart },
  { key: "bookmarks", label: "Bookmarks", icon: Bookmark },
];

export default function ProfilePage() {
  const { user, loading, refresh } = useAuth();
  const [tab, setTab] = useState("overview");

  if (loading) {
    return <Loading variant="page" />;
  }

  if (!user) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }}>
        <div className="p-5 flex flex-col gap-3 items-start w-full">
          <p style={{ fontSize: 13.5, color: C.text }}>Log in to see your profile and posts.</p>
          <Link href="/login" style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: C.mustard, borderRadius: 8, padding: "9px 16px", fontWeight: 700, textDecoration: "none" }}>Log in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ProfileHeader user={user} refresh={refresh} />

      <div className="flex items-center justify-between" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-2"
                style={{
                  fontSize: 12.5, color: active ? C.mustard : C.muted, background: "none", border: "none",
                  borderBottom: `2px solid ${active ? C.mustard : "transparent"}`, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        <Link href="/settings" title="Settings & Privacy" style={{ color: C.muted, padding: "8px", flexShrink: 0 }}>
          <SettingsIcon size={16} />
        </Link>
      </div>

      {tab === "overview" && <OverviewTab user={user} />}
      {tab === "posts" && <PostListTab fetcher={api.getMyPosts} emptyText="You haven't posted anything yet." />}
      {tab === "likes" && <PostListTab fetcher={api.getMyLikes} emptyText="Posts you like or react to — with any emoji — show up here." />}
      {tab === "bookmarks" && <PostListTab fetcher={api.getMyBookmarks} emptyText="Bookmark a post from its share menu to save it here." />}
    </div>
  );
}

/* ---------------------------------------------------------
   HEADER — avatar, pseudonym, real name, bio, badges
--------------------------------------------------------- */
function ProfileHeader({ user, refresh }) {
  const [roastOpen, setRoastOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState(null);
  const [preview, setPreview] = useState(null);
  const dialog = useDialog();

  async function handleFileChange(e) {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setAvatarError(null);
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setAvatarError("Please choose a PNG, JPEG or WEBP image."); input.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { setAvatarError("That image is over 5MB. Please choose a smaller one."); input.value = ""; return; }
    // Show the new picture immediately; the saved one replaces it once confirmed.
    const local = URL.createObjectURL(file);
    setPreview(local);
    setUploading(true);
    try {
      await api.uploadAvatar(file);
      await refresh();
      dialog.toast("Profile picture updated.");
    } catch (err) {
      setAvatarError(err.message || "We couldn't update your picture. Please try again.");
    } finally {
      setUploading(false);
      setPreview(null);
      URL.revokeObjectURL(local);
      input.value = "";
    }
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5">
      <ResumeRoastModal open={roastOpen} onClose={() => setRoastOpen(false)} />
      <div className="flex items-center gap-4">
        <div style={{ position: "relative" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.surface2, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 22, overflow: "hidden", ...displayFont }}>
            {preview || user.avatarUrl ? (
              <img src={preview || user.avatarUrl} alt={user.pseudonym} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              user.pseudonym?.[0]?.toUpperCase() || "?"
            )}
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="Change avatar"
            style={{
              position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: "50%",
              background: C.mustard, border: `2px solid ${C.surface}`, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer",
            }}
          >
            <Camera size={11} color="#FFFFFF" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} style={{ display: "none" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...displayFont, fontSize: 19, color: C.text }}><span className="inline-flex items-center">{user.pseudonym}<VerifiedTick tier={user.premiumTier} size={17} /></span></div>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 1 }}>{user.realName}</div>
          <Link href="/profile/insights" style={{ ...monoFont, fontSize: 12, color: C.mustard, textDecoration: "none", display: "inline-block", marginTop: 4 }}>Profile insights →</Link>
          {user.badges?.length > 0 && (
            <div className="flex gap-1 flex-wrap" style={{ marginTop: 6 }}>
              {user.badges.slice(0, 4).map((b) => (
                <span key={b.key} title={b.description} style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 20, padding: "2px 8px" }}>{b.label}</span>
              ))}
              {user.badges.length > 4 && <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>+{user.badges.length - 4} more</span>}
            </div>
          )}
        </div>
        <div className="text-right" style={{ flexShrink: 0 }}>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase" }}>Badges</div>
          <div style={{ ...displayFont, fontSize: 22, color: C.mustard }}>{user.badges?.length || 0}</div>
        </div>
      </div>

      {avatarError && <div style={{ marginTop: 8 }}><ErrorNote>{avatarError}</ErrorNote></div>}
      {user.bio && <p style={{ fontSize: 13, color: C.text, marginTop: 12, lineHeight: 1.5 }}>{user.bio}</p>}

      <button
        onClick={() => setRoastOpen(true)}
        className="flex items-center gap-2 mt-4 w-full"
        style={{ background: alpha(C.mustard, 8), border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 8, padding: "9px 12px", color: C.mustard, fontSize: 12.5 }}
      >
        <Sparkles size={14} /> Roast My Resume <span style={{ marginLeft: "auto", ...monoFont, fontSize: 12, color: C.muted }}>opt-in · AI icebreaker</span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------
   OVERVIEW TAB
--------------------------------------------------------- */
function OverviewTab({ user }) {
  const [cringeHistory, setCringeHistory] = useState(null);

  useEffect(() => {
    api.getMyPosts()
      .then((posts) => {
        const confessions = posts
          .filter((p) => (p.type === "confession" || p.type === "parody") && !p.repostOf)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 3);
        setCringeHistory(confessions);
      })
      .catch(() => setCringeHistory([]));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div style={{ background: C.surface, border: `1px solid ${user.isPremium ? alpha(C.mustard, 33) : C.line}`, borderRadius: 10 }} className="p-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={15} color={user.isPremium ? C.mustard : C.muted} />
          <div>
            <div style={{ fontSize: 13, color: C.text }}>{({ basic: "OUT plan", plus: "OUT+ plan", pro: "OUT PRO plan" })[user.effectiveTier || user.premiumTier || "basic"]}</div>
            <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>{({ basic: "ads on · light translator access · join Vent Rooms", plus: "ads off · extended translator access · Resume Roast AI · join Vent Rooms", pro: "ads off · highest translator access · extended Resume Roast AI · host Vent Rooms" })[user.premiumTier || "basic"]}</div>
          </div>
        </div>
        <Link href="/premium" style={{ ...monoFont, fontSize: 12, color: user.isPremium ? C.muted : C.mustard, border: `1px solid ${user.isPremium ? C.line : alpha(C.mustard, 33)}`, borderRadius: 8, padding: "7px 12px", textDecoration: "none" }}>
          {user.isPremium ? "Manage" : "Upgrade"}
        </Link>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5">
        <div className="flex items-center gap-2 mb-3" style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          <Skull size={13} /> Your Cringe History
        </div>
        {cringeHistory === null && <Loading />}
        {cringeHistory?.length === 0 && (
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
            No confessions or parody posts yet — post one from the composer and it'll show up here.
          </div>
        )}
        <div className="flex flex-col gap-3">
          {cringeHistory?.map((p) => (
            <div key={p.id} className="flex gap-3">
              <div style={{ ...monoFont, fontSize: 12, color: C.muted, width: 62, flexShrink: 0, paddingTop: 2 }}>{p.time}</div>
              <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5, borderLeft: `2px solid ${C.line}`, paddingLeft: 10 }}>{p.text}</div>
            </div>
          ))}
        </div>
      </div>

      <Link
        href="/title-translator"
        style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, textDecoration: "none" }}
        className="p-5 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <Sparkles size={15} color={C.corpblue} />
          <div>
            <div style={{ fontSize: 13, color: C.text }}>Humble Brag Translator</div>
            <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>Translate your real title into full corporate hype, or decode the reverse</div>
          </div>
        </div>
        <ChevronDown size={15} color={C.muted} style={{ transform: "rotate(-90deg)" }} />
      </Link>

      <Link href="/companies" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, textDecoration: "none" }} className="p-5 flex items-center justify-between">
        <div>
          <div style={{ fontSize: 13, color: C.text }}>Salary transparency</div>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 2 }}>Contribute a salary anonymously to any company page</div>
        </div>
        <ChevronDown size={15} color={C.muted} style={{ transform: "rotate(-90deg)" }} />
      </Link>

      <LogoutCard user={user} />
    </div>
  );
}

// Log out lives in the profile (not a corner icon): a clearly labelled button, with a confirmation.
function LogoutCard({ user }) {
  const { logout } = useAuth();
  const dialog = useDialog();
  const router = useRouter();
  async function confirm() {
    const ok = await dialog.confirm({ title: "Log out?", message: "You can always log back in.", confirmLabel: "Log out", danger: true });
    if (!ok) return;
    try { await logout(); } finally { router.push("/"); }
  }
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5 flex flex-col gap-3">
      <Link href="/my-stories" className="lo-btn lo-btn-secondary" style={{ textDecoration: "none", justifyContent: "center" }}>My stories &amp; drafts</Link>
      <div style={{ fontSize: 13, color: C.text }}>Signed in{user?.pseudonym ? ` as ${user.pseudonym}` : ""}</div>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: -6 }}>Log out on this device. Your account and data stay safe.</div>
      <button onClick={confirm} aria-label="Log out" className="flex items-center justify-center gap-2 w-full lo-tap"
        style={{ border: `1px solid ${alpha(C.flag, 55)}`, background: alpha(C.flag, 8), color: C.flag, borderRadius: 10, padding: "11px 14px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
        <LogOut size={16} /> Log out
      </button>
    </div>
  );
}

/* ---------------------------------------------------------
   MY POSTS TAB
--------------------------------------------------------- */
function PostListTab({ fetcher, emptyText }) {
  const [posts, setPosts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetcher().then(setPosts).catch((e) => setError(e.message));
  }, [fetcher]);

  return (
    <div className="flex flex-col gap-4">
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>
        Real Name and Alias posts match by identity; Full Anonymous posts aren't linkable back to you even here — by design.
      </div>
      {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't load: {error}</div>}
      {!posts && !error && <Loading />}
      {posts && posts.length === 0 && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{emptyText}</div>}
      {posts && posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}
