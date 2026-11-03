"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { PenLine, Flame, Clock, Briefcase, Languages, Users, Radio, TrendingDown, BellPlus } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { STORY_CATEGORIES, STORY_FORMATS } from "@/lib/stories/constants";
import { StoryCard, Chip } from "@/components/stories/StoryBits";
import AdCard from "@/components/AdCard";
import AdSenseUnit from "@/components/AdSenseUnit";
import useFeedAds from "@/components/useFeedAds";
import Loading from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import Select from "@/components/ui/Select";

// LinkedOut's home is the Story feed: "What's actually happening?"
// Pulse (/pulse) is the casual short-form feed. The two feed each other.
function StoriesHome() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const category = params.get("category") || "";
  const format = params.get("format") || "";
  const [sort, setSort] = useState("recent");
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [savedMsg, setSavedMsg] = useState(null);
  const { cfg, sense, adFor, notes } = useFeedAds();

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.getStories({ category, format, sort });
      setStories(r.stories); setMore(r.hasMore);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [category, format, sort]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const h = () => load(); window.addEventListener("lo:home-refresh", h); return () => window.removeEventListener("lo:home-refresh", h); }, [load]);
  useEffect(() => { api.getStoryStats().then(setStats).catch(() => {}); }, []);

  async function loadMore() {
    if (!stories.length) return;
    setMoreBusy(true);
    try { const r = await api.getStories({ category, format, sort, before: stories[stories.length - 1].createdAt }); setStories((s) => [...s, ...r.stories]); setMore(r.hasMore); }
    catch (e) { setError(e.message); } finally { setMoreBusy(false); }
  }
  const setFilter = (k, v) => { const p = new URLSearchParams(params.toString()); if (v) p.set(k, v); else p.delete(k); router.push(`/${p.toString() ? `?${p}` : ""}`); };

  return (
    <div className="flex flex-col gap-4">
      {notes.map((a) => (
        <div key={a.id} role="note" style={{ background: alpha(C.corpblue, 12), border: `1px solid ${C.corpblue}`, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{a.title}</div>
          {a.body && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{a.body}</div>}
        </div>
      ))}

      <section className="lo-card flex flex-col gap-3" style={{ padding: 18, background: `linear-gradient(160deg, ${alpha(C.mustard, 10)}, ${C.surface})` }}>
        <div>
          <div className="lo-eyebrow" style={{ color: C.mustard }}>The workplace truth feed</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 780, letterSpacing: "-0.025em", color: C.text, lineHeight: 1.2 }}>What's actually happening?</h1>
          <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.muted, lineHeight: 1.5 }}>Real experiences from real workplaces. Share yours, and find the people who know what you're going through.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={user ? "/stories/new" : "/login"} className="lo-btn lo-btn-primary lo-btn-lg" style={{ textDecoration: "none" }}><PenLine size={17} /> Tell us what happened</Link>
          <Link href={user ? "/stories/new?format=laid_off" : "/login"} className="lo-btn lo-btn-secondary lo-btn-lg" style={{ textDecoration: "none" }}>I was laid off</Link>
        </div>
      </section>

      {stats && stats.totalStories > 0 && (
        <div className="flex gap-2 flex-wrap" style={{ ...monoFont, fontSize: 12.5, color: C.muted }} title={stats.note}>
          {stats.laidOff > 0 && <span style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}><b style={{ color: C.text }}>{stats.laidOff.toLocaleString()}</b> shared a layoff story</span>}
          {stats.ghosted > 0 && <span style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}><b style={{ color: C.text }}>{stats.ghosted.toLocaleString()}</b> were ghosted</span>}
          {stats.salaryDiscrepancies > 0 && <span style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}><b style={{ color: C.text }}>{stats.salaryDiscrepancies.toLocaleString()}</b> reported a salary difference</span>}
        </div>
      )}

      <nav aria-label="Explore" className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        {[
          { href: "/layoffs", icon: TrendingDown, title: "Layoff Tracker", sub: "User-reported vs documented" },
          { href: "/companies", icon: Briefcase, title: "Before you join", sub: "What employees are saying" },
          { href: "/circles", icon: Users, title: "Support Circles", sub: "Anonymous, by experience" },
          { href: "/alerts", icon: BellPlus, title: "Alerts", sub: "Saved searches" },
          { href: "/translator", icon: Languages, title: "Reality Translator", sub: "Corporate speak, decoded" },
          { href: "/pulse", icon: Radio, title: "Pulse", sub: "What's being said right now" },
        ].map(({ href, icon: Icon, title, sub }) => (
          <Link key={href} href={href} className="lo-card lo-tap flex flex-col gap-1" style={{ padding: 12, textDecoration: "none" }}>
            <Icon size={17} color={C.mustard} />
            <div style={{ fontSize: 14, fontWeight: 680, color: C.text }}>{title}</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>{sub}</div>
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 overflow-x-auto" style={{ paddingBottom: 4 }} role="tablist" aria-label="Story categories">
          <Chip active={!category} onClick={() => setFilter("category", "")}>All</Chip>
          {STORY_CATEGORIES.map((c) => <Chip key={c} active={category === c} onClick={() => setFilter("category", category === c ? "" : c)}>{c}</Chip>)}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={`lo-btn lo-btn-sm ${sort === "recent" ? "lo-btn-secondary" : "lo-btn-ghost"}`} onClick={() => setSort("recent")}><Clock size={14} /> Latest</button>
          <button className={`lo-btn lo-btn-sm ${sort === "resonating" ? "lo-btn-secondary" : "lo-btn-ghost"}`} onClick={() => setSort("resonating")}><Flame size={14} /> Resonating this month</button>
          {user && (category || format) && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { try { await api.saveSearch({ category, format }); setSavedMsg("Saved. Manage it under Alerts."); } catch (e) { setSavedMsg(e.code === "PLAN_REQUIRED" ? "Saved searches and alerts are part of OUT+." : e.message); } }}><BellPlus size={14} /> Save this search</button>}
          {savedMsg && <span style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{savedMsg}</span>}
          <Select aria-label="Story format" value={format} onChange={(e) => setFilter("format", e.target.value)} style={{ marginLeft: "auto", background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 9, padding: "7px 10px", fontSize: 13 }}>
            <option value="">All formats</option>
            {STORY_FORMATS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </Select>
        </div>
      </div>

      {loading && <Loading variant="cards" />}
      {error && <div style={{ ...monoFont, fontSize: 13, color: C.flag }}>{error}</div>}
      {!loading && !error && stories.length === 0 && (
        <div className="lo-card"><EmptyState icon={PenLine} title={category ? `No “${category}” stories yet` : "No stories yet"} actionLabel="Tell us what happened" href={user ? "/stories/new" : "/login"}>Be the first. Your story helps the next person who thinks it was only them.</EmptyState></div>
      )}
      {stories.map((s, i) => {
        const slot = adFor(i);
        return (
          <div key={s.id} className="flex flex-col gap-4">
            <StoryCard story={s} />
            {slot && (slot.kind === "direct" ? <AdCard ad={slot.ad} label={cfg.adLabel} defaultLayout={cfg.adStyle} /> : <AdSenseUnit client={sense.client} slot={sense.slot} />)}
          </div>
        );
      })}
      {more && <button onClick={loadMore} disabled={moreBusy} className="lo-btn lo-btn-secondary" style={{ alignSelf: "center" }}>{moreBusy ? "Loading…" : "Older stories"}</button>}
    </div>
  );
}

export default function Page() { return <Suspense fallback={<Loading variant="cards" />}><StoriesHome /></Suspense>; }
