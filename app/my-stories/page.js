"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PenLine } from "lucide-react";
import { C, monoFont } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";

export default function MyStories() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { if (user) api.getMyStories().then((r) => setRows(r.stories)).catch((e) => setErr(e.message)); }, [user]);
  if (loading) return <Loading variant="cards" />;
  if (!user) return <div className="lo-card"><EmptyState icon={PenLine} title="Log in to see your stories" actionLabel="Log in" href="/login" /></div>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Private to you" title="My stories" subtitle="Published stories, scheduled stories and private drafts. Only you can see this page." actions={<Link href="/stories/new" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>New story</Link>} />
      {err && <div style={{ color: C.flag, fontSize: 13 }}>{err}</div>}
      {!rows && !err && <Loading variant="cards" />}
      {rows?.length === 0 && <div className="lo-card"><EmptyState icon={PenLine} title="You haven't shared a story yet" actionLabel="Tell us what happened" href="/stories/new" /></div>}
      {rows?.map((s) => (
        <Link key={s.id} href={s.status === "draft" || s.status === "scheduled" ? `/stories/new?draft=${s.id}` : `/stories/${s.id}`} className="lo-card lo-tap flex flex-col gap-1" style={{ padding: 14, textDecoration: "none" }}>
          <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{s.formatLabel}{s.company ? ` · ${s.company}` : ""} · {s.time} · <b style={{ color: s.status === "published" ? C.green : C.mustard }}>{s.status}</b>{s.status !== "published" && <span style={{ color: C.mustard }}> · tap to continue editing</span>}</div>
          <div style={{ fontSize: 15.5, color: C.text, fontWeight: 650 }}>{s.title || s.body.slice(0, 100)}</div>
          <div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{s.counts.total} “me too” · {s.counts.updates} updates · {s.counts.evidence} evidence</div>
        </Link>
      ))}
    </div>
  );
}
