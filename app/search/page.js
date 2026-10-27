"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Search as SearchIcon, User, Building2, Briefcase, Mic, MessageSquare } from "lucide-react";
import { C, monoFont, displayFont } from "@/lib/theme";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";

// Jobs search tab is paused along with the Jobs page itself (see
// components/Shell.jsx's JOBS_ENABLED) — flip both back together.
const JOBS_ENABLED = false;

const CATEGORIES = [
  { key: "posts", label: "Posts", icon: MessageSquare },
  { key: "people", label: "People", icon: User },
  { key: "companies", label: "Companies", icon: Building2 },
  ...(JOBS_ENABLED ? [{ key: "jobs", label: "Jobs", icon: Briefcase }] : []),
  { key: "rooms", label: "Vent Rooms", icon: Mic },
];

function ResultRow({ children, href }) {
  return (
    <Link href={href} style={{ display: "block", padding: "10px 12px", borderBottom: `1px solid ${C.line}`, textDecoration: "none", color: C.text, fontSize: 13 }}>
      {children}
    </Link>
  );
}

function SearchInner() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [category, setCategory] = useState("posts");
  const [busy, setBusy] = useState(false);

  async function runSearch(value) {
    setQ(value);
    if (value.trim().length < 2) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      const data = await api.search(value.trim());
      setResults(data);
    } catch {
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  // Arrive from the feed search bar (/search?q=…): run that query straight away.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial && initial.trim().length >= 2) runSearch(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = results?.[category] || [];

  return (
    <div className="flex flex-col gap-4">
      <div style={{ ...displayFont, fontSize: 20, color: C.text }}>Search</div>
      <div className="flex items-center gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px" }}>
        <SearchIcon size={15} color={C.muted} />
        <input
          value={q}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search posts, people, companies, jobs, rooms..."
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 13.5 }}
          autoFocus
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          const active = category === c.key;
          const count = results?.[c.key]?.length ?? 0;
          return (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className="flex items-center gap-1.5"
              style={{ ...monoFont, fontSize: 12, padding: "5px 10px", borderRadius: 20, border: `1px solid ${active ? C.mustard : C.line}`, color: active ? C.mustard : C.muted, background: "none", cursor: "pointer" }}
            ><Icon size={12} /> {c.label}{results ? ` (${count})` : ""}</button>
          );
        })}
      </div>

      {busy && <Loading variant="list" rows={3} />}
      {q.trim().length > 0 && q.trim().length < 2 && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>keep typing — 2+ characters</div>}

      {results && (
        <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
          {items.length === 0 && <div style={{ padding: 16, ...monoFont, fontSize: 12, color: C.muted }}>No {category} matched "{q}".</div>}
          {category === "posts" && items.map((p) => (
            <ResultRow key={p.id} href={`/#post-${p.id}`}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{p.author}</div>
              <div style={{ color: C.muted }}>{(p.title ? p.title + " — " : "") + p.text.slice(0, 100)}</div>
            </ResultRow>
          ))}
          {category === "people" && items.map((p) => (
            <ResultRow key={p.handle} href={`/u/${p.handle}`}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{p.pseudonym}</div>
              {p.bio && <div style={{ color: C.muted, fontSize: 12 }}>{p.bio}</div>}
            </ResultRow>
          ))}
          {category === "companies" && items.map((c) => (
            <ResultRow key={c.id} href="/companies">
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{c.name}</div>
              {c.industry && <div style={{ color: C.muted, fontSize: 12 }}>{c.industry}</div>}
            </ResultRow>
          ))}
          {category === "jobs" && items.map((j) => (
            <ResultRow key={j.id} href="/jobs">
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{j.title}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{j.company}</div>
            </ResultRow>
          ))}
          {category === "rooms" && items.map((r) => (
            <ResultRow key={r.id} href="/vent">
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{r.topic}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{r.vibe}</div>
            </ResultRow>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return <SearchInner />;
}
