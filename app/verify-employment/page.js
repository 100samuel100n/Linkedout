"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Mail, FileText, ShieldCheck } from "lucide-react";
import { C, monoFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";
import Loading from "@/components/ui/Loading";

const field = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 14.5, width: "100%", fontFamily: "inherit" };
const STATUS = { verified: [C.green, "Verified"], pending: [C.mustard, "Under review"], rejected: [C.flag, "Not verified"], expired: [C.muted, "Expired"] };

export default function VerifyEmployment() {
  const { user, loading } = useAuth();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(null); const [ok, setOk] = useState(null);
  const [method, setMethod] = useState("email"); const [f, setF] = useState({ companyName: "", kind: "current", email: "" });
  const [pend, setPend] = useState(null); const [code, setCode] = useState(""); const fileRef = useRef(null); const [busy, setBusy] = useState(false);
  const load = () => api.getMyVerifications().then((r) => setRows(r.verifications)).catch((e) => setErr(e.message));
  useEffect(() => { if (user) load(); }, [user]);
  if (loading) return <Loading variant="cards" />;
  if (!user) return <div className="lo-card" style={{ padding: 24 }}><Link href="/login" className="lo-btn lo-btn-primary" style={{ textDecoration: "none" }}>Log in to verify employment</Link></div>;
  async function send() { setBusy(true); setErr(null); try { setPend(await api.startWorkEmail(f)); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  async function confirm() { setBusy(true); setErr(null); try { const r = await api.confirmWorkEmail({ id: pend.id, code }); setPend(null); setCode(""); setOk(r.pendingReview ? r.message : "You're verified. Your stories about this company now carry the badge."); load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  async function upload() { const file = fileRef.current?.files?.[0]; if (!file) return setErr("Choose a document first."); setBusy(true); setErr(null); try { const fd = new FormData(); fd.set("companyName", f.companyName); fd.set("kind", f.kind); fd.set("file", file); await api.submitEmploymentDoc(fd); setOk("Submitted. A reviewer will look at it, then the file is deleted."); load(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader eyebrow="Verified employee" title="Earn the badge, keep your anonymity" subtitle="Stories from verified employees are weighted by readers as more credible. Verification is private: employers are never told, and the badge doesn't reveal who you are." />
      <section className="lo-card flex flex-col gap-3" style={{ padding: 18 }}>
        <div className="flex gap-1.5">{[["current", "I work there now"], ["former", "I used to work there"]].map(([k, l]) => <button key={k} onClick={() => setF({ ...f, kind: k })} className="lo-btn lo-btn-sm" style={{ background: f.kind === k ? C.mustard : "transparent", color: f.kind === k ? "#fff" : C.text2, border: `1px solid ${f.kind === k ? C.mustard : C.line}` }}>{l}</button>)}</div>
        <input style={field} placeholder="Company name (as on its LinkedOut page)" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
        <div className="flex gap-2">{[["email", "Work email", Mail], ["doc", "Document", FileText]].map(([k, l, I]) => <button key={k} onClick={() => setMethod(k)} className="lo-btn lo-btn-secondary lo-btn-sm" style={{ borderColor: method === k ? C.mustard : C.line, color: method === k ? C.mustard : C.text2 }}><I size={14} /> {l}</button>)}</div>
        {method === "email" ? (pend ? (
          <div className="flex flex-col gap-2"><div style={{ fontSize: 14, color: C.text }}>We sent a 6-digit code to your {pend.domain} address. It expires in {pend.expiresInMin} minutes.</div><input style={{ ...field, letterSpacing: 8, fontSize: 20, textAlign: "center", maxWidth: 220 }} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /><div><button disabled={busy || code.length !== 6} onClick={confirm} className="lo-btn lo-btn-primary">Confirm</button></div></div>
        ) : (
          <div className="flex flex-col gap-2"><input style={field} type="email" placeholder="you@company.com" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /><div style={{ fontSize: 12.5, color: C.muted }}>We store only the domain, never the address, and don't tell your employer. Former employees: if your address no longer works, use a document.</div><div><button disabled={busy || !f.companyName || !f.email} onClick={send} className="lo-btn lo-btn-primary">Send code</button></div></div>
        )) : (
          <div className="flex flex-col gap-2"><input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" style={{ fontSize: 13 }} /><div style={{ fontSize: 12.5, color: C.muted }}>A payslip, contract or work ID. Black out anything unrelated. It's reviewed by one person and then deleted.</div><div><button disabled={busy || !f.companyName} onClick={upload} className="lo-btn lo-btn-primary">Submit for review</button></div></div>
        )}
      </section>
      {ok && <div style={{ background: alpha(C.green, 12), border: `1px solid ${alpha(C.green, 35)}`, borderRadius: 12, padding: "10px 14px", fontSize: 14 }}>{ok}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {rows?.length > 0 && <section className="flex flex-col gap-2"><h2 style={{ margin: 0, fontSize: 17, fontWeight: 720, color: C.text }}>Your verifications</h2>{rows.map((r) => { const [col, label] = STATUS[r.status] || STATUS.pending; return (
        <div key={r.id} className="lo-card flex items-center gap-3 flex-wrap" style={{ padding: 14 }}>
          <BadgeCheck size={18} color={col} /><div style={{ flex: 1 }}><div style={{ fontWeight: 650, color: C.text }}>{r.company_name}</div><div style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>{r.kind} · {r.method === "work_email" ? "work email" : "document"} · <span style={{ color: col }}>{label}</span>{r.status === "verified" && r.expires_at ? ` · renews by ${r.expires_at.slice(0, 10)}` : ""}</div>{r.status === "rejected" && r.note && <div style={{ fontSize: 13, color: C.muted }}>{r.note}</div>}</div>
          {r.status === "verified" && r.kind === "current" && <button className="lo-btn lo-btn-ghost lo-btn-sm" onClick={async () => { await api.endVerification(r.id, "former"); load(); }}>I've left</button>}
        </div>); })}</section>}
      <div style={{ fontSize: 12.5, color: C.muted }}><ShieldCheck size={13} style={{ display: "inline", marginRight: 4 }} />Verification confirms a connection to the company. It does not confirm that any story is true.</div>
    </div>
  );
}
