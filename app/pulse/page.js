"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ArrowUp, Search as SearchIcon } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { usePosts } from "../providers";
import { useAuth } from "@/app/auth-provider";
import { useComposer } from "@/app/composer-provider";
import PostCard from "@/components/PostCard";
import AdCard from "@/components/AdCard";
import AdSenseUnit from "@/components/AdSenseUnit";
import { api } from "@/lib/api";
import { POST_TYPES } from "@/lib/data";
import Loading from "@/components/ui/Loading";
import Link from "next/link";
import { BookOpen } from "lucide-react";

const AD_FREQUENCY = 4; // one ad every N posts — the cap that keeps this from becoming a nuisance

export default function PulsePage() {
  const { posts, loading, error, hasMore, loadMore, loadingMore, refresh, refreshing, newCount } = usePosts();
  const { user } = useAuth();
  const composer = useComposer();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [ads, setAds] = useState([]);
  const [cfg, setCfg] = useState({ adsEnabled: true, adEvery: AD_FREQUENCY, announcements: [] });

  useEffect(() => {
    api.getAds().then(setAds).catch(() => setAds([]));
    api.getFeedConfig().then(setCfg).catch(() => {});
  }, []);

  const audienceOk = cfg.adAudience === "all" || !user?.isPremium;
  const masterOn = cfg.adsEnabled && audienceOk;
  const direct = masterOn && cfg.mix !== "network only" && ads.length > 0;
  const pinned = ads.filter((a) => Number.isInteger(a.position));
  // Weighted rotation: priority 1–10 means "appears that many times in the rotation".
  const rotation = ads.filter((a) => !Number.isInteger(a.position)).flatMap((a) => Array(Math.min(10, Math.max(1, a.weight || 1))).fill(a));
  const rot = rotation.length ? rotation : ads;
  const sense = masterOn && cfg.adsense?.enabled ? cfg.adsense : null;
  function adFor(i) {
    // 1) pinned position wins; 2) direct rotation; 3) AdSense in its own slots.
    if (direct) {
      const pin = pinned.find((a) => a.position === i + 1);
      if (pin) return { kind: "direct", ad: pin };
      if (cfg.adEvery && (i + 1) % cfg.adEvery === 0 && rot.length) return { kind: "direct", ad: rot[Math.floor(i / cfg.adEvery) % rot.length] };
    }
    if (sense && (i + 1) % sense.every === 0) return { kind: "adsense" };
    return null;
  }
  const notes = (cfg.announcements || []).filter((a) => a.audience === "all" || (a.audience === "premium" ? user?.isPremium : !user?.isPremium));

  return (
    <div className="flex flex-col gap-4">
      {notes.map((a) => (
        <div key={a.id} role="note" style={{ background: a.severity === "critical" ? alpha(C.flag, 14) : a.severity === "warning" ? alpha(C.mustard, 16) : alpha(C.corpblue, 12), border: `1px solid ${a.severity === "critical" ? C.flag : a.severity === "warning" ? C.mustard : C.corpblue}`, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ ...monoFont, fontSize: 12.5, fontWeight: 700, color: C.text }}>{a.title}</div>
          {a.body && <div style={{ fontSize: 13, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>{a.body}</div>}
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ padding: "2px 2px 0" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 750, color: C.text, letterSpacing: "-0.02em" }}>Pulse</div>
          <div style={{ fontSize: 13.5, color: C.muted }}>What's being said right now. Short thoughts, questions, jokes and quick opinions.</div>
        </div>
        <Link href="/stories/new" className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }}><BookOpen size={14} /> Tell the full story</Link>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-4 w-full">
        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/search?q=${encodeURIComponent(t)}`); }}
          className="flex items-center gap-2 mb-3"
        >
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px" }}>
            <SearchIcon size={14} color={C.muted} />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search Pulse, people, companies, rooms..."
              aria-label="Search posts, people, companies and rooms"
              enterKeyHint="search"
              style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: C.text, fontSize: 13 }}
            />
          </div>
        </form>
        <div className="flex items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {POST_TYPES.map((t) => (
              <button key={t} type="button" onClick={composer.open} style={{ ...monoFont, fontSize: 12, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 20, padding: "3px 9px", background: "none", cursor: "pointer" }}>{t}</button>
            ))}
          </div>
          <button type="button" onClick={composer.open} style={{ background: C.mustard, color: "#FFFFFF", fontSize: 12, fontWeight: 700, borderRadius: 6, padding: "6px 14px", border: "none", cursor: "pointer" }}>Post</button>
        </div>
      </div>

      {newCount > 0 && (
        <button
          onClick={() => { refresh(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="lo-tap flex items-center justify-center gap-2"
          style={{ position: "sticky", top: 8, zIndex: 20, ...monoFont, fontSize: 12, fontWeight: 700, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 10, padding: "9px 16px", cursor: "pointer", alignSelf: "center", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
        >
          <ArrowUp size={13} /> {newCount} new post{newCount === 1 ? "" : "s"}
        </button>
      )}

      <div className="flex items-center gap-2">
        <button onClick={refresh} disabled={refreshing} className="lo-tap ml-auto flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 10px", cursor: "pointer" }}>
          <RefreshCw size={11} className={refreshing ? "lo-spin" : ""} /> Refresh
        </button>
      </div>

      {loading && <Loading variant="cards" />}
      {error && <div style={{ ...monoFont, fontSize: 12, color: C.flag }}>couldn't load the feed: {error}</div>}

      {posts.map((p, i) => (
        <div key={p.id} className="flex flex-col gap-4">
          <PostCard post={p} />
          {(() => {
            const slot = adFor(i);
            if (!slot) return null;
            return slot.kind === "direct"
              ? <AdCard ad={slot.ad} label={cfg.adLabel} defaultLayout={cfg.adStyle} />
              : <AdSenseUnit client={sense.client} slot={sense.slot} />;
          })()}
        </div>
      ))}

      {hasMore && (
        <button onClick={loadMore} disabled={loadingMore} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.text, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "11px 16px", cursor: "pointer", alignSelf: "center" }}>
          {loadingMore ? <Loading variant="inline" /> : "Load older posts"}
        </button>
      )}
    </div>
  );
}
