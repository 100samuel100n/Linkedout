"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Users, Plus, Lock, Crown, ShieldCheck, Hourglass } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import Loading from "@/components/ui/Loading";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";

const field = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 14.5, width: "100%", fontFamily: "inherit" };

export default function Circles() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null); const [canCreate, setCanCreate] = useState(0); const [err, setErr] = useState(null);
  const [tab, setTab] = useState("all"); const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", description: "", rules: "", joinMode: "open", visibility: "public" });
  const [busy, setBusy] = useState(false);
  const load = () => api.getCircles().then((r) => { setRows(r.circles); setCanCreate(r.canCreate); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [user]); // eslint-disable-line
  async function join(c) { try { const r = await api.joinCircle(c.slug); load(); if (r.state === "pending") setErr("Request sent. A moderator will review it."); } catch (e) { setErr(e.status === 401 ? "Log in to join a circle." : e.message); } }
  async function create() {
    setBusy(true); setErr(null);
    try { const r = await api.createCircle(f); window.location.href = `/circles/${r.slug}`; } catch (e) { setErr(e.message); setBusy(false); }
  }
  const shown = (rows || []).filter((c) => tab === "all" || (tab === "mine" && c.me) || (tab === "official" && c.official) || (tab === "community" && !c.official));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Support Circles" title="People who've been where you are" subtitle="Small, anonymous communities organised by experience. Membership is never shown. Anyone can join; OUT+ members can start one." actions={user && (
        <button onClick={() => setOpen((o) => !o)} className="lo-btn lo-btn-primary"><Plus size={16} /> Start a circle</button>
      )} />
      {open && (
        <section className="lo-card flex flex-col gap-3" style={{ padding: 18, borderColor: alpha(C.mustard, 40) }}>
          {canCreate === 0 ? (
            <div style={{ fontSize: 14.5, color: C.text }}><Lock size={14} style={{ display: "inline", marginRight: 6 }} />Starting a circle is part of <Link href="/premium" style={{ color: C.mustard, fontWeight: 650 }}>OUT+</Link> (1 circle) and <b>OUT PRO</b> (up to 5, unlisted option). Joining is always free.</div>
          ) : (<>
            <div style={{ fontSize: 16, fontWeight: 720, color: C.text }}>Start a circle</div>
            <input style={field} placeholder="Name, e.g. Laid off in fintech" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <textarea style={{ ...field, lineHeight: 1.5 }} rows={3} placeholder="Who is it for, and what should members expect?" maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <textarea style={{ ...field, lineHeight: 1.5 }} rows={4} placeholder={"House rules (optional)\n1. Be kind. 2. No names of private people. 3. Ask before giving advice."} maxLength={1500} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} />
            <div className="flex gap-2 flex-wrap">
              {[["open", "Anyone can join"], ["request", "Members approved by me"]].map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, joinMode: k })} className="lo-btn lo-btn-sm" style={{ background: f.joinMode === k ? C.mustard : "transparent", color: f.joinMode === k ? "#fff" : C.text2, border: `1px solid ${f.joinMode === k ? C.mustard : C.line}` }}>{l}</button>)}
              {canCreate > 1 && [["public", "Listed"], ["unlisted", "Unlisted (link only)"]].map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, visibility: k })} className="lo-btn lo-btn-sm" style={{ background: f.visibility === k ? C.mustard : "transparent", color: f.visibility === k ? "#fff" : C.text2, border: `1px solid ${f.visibility === k ? C.mustard : C.line}` }}>{l}</button>)}
            </div>
            <div style={{ fontSize: 12.5, color: C.muted }}>You'll be the owner and appear as your alias. You can add moderators, approve members and archive the circle any time. LinkedOut staff can suspend circles that break the rules.</div>
            <div><button disabled={busy} onClick={create} className="lo-btn lo-btn-primary">{busy ? "Creating…" : "Create circle"}</button></div>
          </>)}
        </section>
      )}
      <div className="flex gap-1.5 flex-wrap">{[["all", "All"], ["mine", "My circles"], ["official", "Official"], ["community", "Community-run"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className="lo-btn lo-btn-sm" style={{ background: tab === k ? C.mustard : "transparent", color: tab === k ? "#fff" : C.text2, border: `1px solid ${tab === k ? C.mustard : C.line}` }}>{l}</button>)}</div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {!rows && <Loading variant="cards" />}
      {rows && shown.length === 0 && <div className="lo-card" style={{ padding: 20, color: C.muted, fontSize: 14.5 }}>{tab === "mine" ? "You haven't joined a circle yet." : "No circles here yet."}</div>}
      {shown.map((c) => (
        <div key={c.id} className="lo-card flex flex-col gap-2" style={{ padding: 16 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <Users size={16} color={C.mustard} />
            <Link href={`/circles/${c.slug}`} style={{ fontSize: 17, fontWeight: 720, color: C.text, textDecoration: "none" }}>{c.name}</Link>
            {c.official && <span style={{ ...monoFont, fontSize: 11.5, color: C.corpblue, border: `1px solid ${alpha(C.corpblue, 40)}`, borderRadius: 999, padding: "1px 8px" }}><ShieldCheck size={11} style={{ display: "inline" }} /> Official</span>}
            {c.me?.role === "owner" && <span style={{ ...monoFont, fontSize: 11.5, color: C.mustard }}><Crown size={11} style={{ display: "inline" }} /> You run this</span>}
            {c.visibility === "unlisted" && <span style={{ ...monoFont, fontSize: 11.5, color: C.muted }}><Lock size={11} style={{ display: "inline" }} /> Unlisted</span>}
          </div>
          <div style={{ fontSize: 14.5, color: C.muted, lineHeight: 1.5 }}>{c.description}</div>
          <div className="flex items-center gap-2 flex-wrap" style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>
            <span>{c.members} members · {c.stories} stories · {c.joinMode === "request" ? "approval to join" : "open"}{c.host && !c.official ? ` · hosted by ${c.host}` : ""}</span>
            <span style={{ marginLeft: "auto" }} className="flex gap-2">
              <Link href={`/circles/${c.slug}`} className="lo-btn lo-btn-secondary lo-btn-sm" style={{ textDecoration: "none" }}>Open</Link>
              {user && !c.me && <button onClick={() => join(c)} className="lo-btn lo-btn-primary lo-btn-sm">{c.joinMode === "request" ? "Request to join" : "Join"}</button>}
              {c.me?.state === "pending" && <span style={{ color: C.mustard }}><Hourglass size={12} style={{ display: "inline" }} /> Waiting for approval</span>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
