"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Settings2, Radio, PenLine, LogOut } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { StoryCard } from "@/components/stories/StoryBits";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";

export default function CirclePage({ params }) {
  const { slug } = use(params);
  const { user } = useAuth();
  const [c, setC] = useState(null); const [stories, setStories] = useState(null); const [err, setErr] = useState(null);
  const load = useCallback(() => {
    api.getCircle(slug).then(setC).catch((e) => setErr(e.message));
    api.getCircleStories(slug).then((r) => setStories(r.stories)).catch(() => setStories([]));
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  if (err && !c) return <ErrorNote>{err}</ErrorNote>;
  if (!c) return <Loading variant="cards" />;
  const member = c.me?.state === "active" || c.me?.state === "muted";
  async function join() { try { await api.joinCircle(slug); load(); } catch (e) { setErr(e.status === 401 ? "Log in to join." : e.message); } }
  async function leave() { try { await api.leaveCircle(slug); load(); } catch (e) { setErr(e.message); } }
  return (
    <div className="flex flex-col gap-4">
      <Link href="/circles" className="inline-flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 13.5 }}><ChevronLeft size={15} /> Circles</Link>
      <header className="lo-card flex flex-col gap-3" style={{ padding: 20 }}>
        <div className="lo-eyebrow" style={{ color: C.mustard }}>{c.official ? "Official circle" : `Community circle${c.host ? ` · hosted by ${c.host}` : ""}`}</div>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 770, letterSpacing: "-0.02em", color: C.text }}>{c.name}</h1>
        <p style={{ margin: 0, fontSize: 15, color: C.muted, lineHeight: 1.55 }}>{c.description}</p>
        <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{c.members} members · {c.stories} stories · {c.joinMode === "request" ? "members are approved" : "open to everyone"}</div>
        {c.status !== "active" && <div style={{ color: C.flag, fontSize: 14 }}>This circle is {c.status} and isn't accepting new stories.</div>}
        <div className="flex gap-2 flex-wrap">
          {!member && c.me?.state !== "pending" && c.me?.state !== "banned" && c.status === "active" && <button onClick={user ? join : () => (window.location.href = "/login")} className="lo-btn lo-btn-primary">{c.joinMode === "request" ? "Request to join" : "Join circle"}</button>}
          {c.me?.state === "pending" && <span style={{ ...monoFont, color: C.mustard, fontSize: 13 }}>Your request is waiting for a moderator.</span>}
          {member && c.status === "active" && <Link href={`/stories/new?circle=${c.slug}`} className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}><PenLine size={15} /> Share a story here</Link>}
          {c.canManage && <Link href={`/circles/${c.slug}/manage`} className="lo-btn lo-btn-secondary" style={{ textDecoration: "none" }}><Settings2 size={15} /> Manage{c.pending ? ` (${c.pending} waiting)` : ""}</Link>}
          {member && !c.isOwner && <button onClick={leave} className="lo-btn lo-btn-ghost"><LogOut size={15} /> Leave</button>}
        </div>
      </header>
      {c.rules && <section className="lo-card" style={{ padding: 16 }}><div className="lo-eyebrow" style={{ marginBottom: 6 }}>House rules</div><div style={{ fontSize: 14.5, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.rules}</div></section>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {!stories && <Loading variant="cards" />}
      {stories?.length === 0 && <div className="lo-card" style={{ padding: 20, color: C.muted }}>No stories in this circle yet.{member ? " Be the first to share." : ""}</div>}
      {stories?.map((s) => <StoryCard key={s.id} story={s} />)}
    </div>
  );
}
