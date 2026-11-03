"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { use, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Trash2, RotateCcw, FileUp, X, Globe2, Clock, Pencil, Save, AlertTriangle, History, ShieldCheck } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { useDialog } from "@/components/Dialog";
import CompanyBadges from "@/components/CompanyBadges";
import { INDUSTRIES } from "@/lib/data";
import Select from "@/components/ui/Select";

const inp = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: "9px 12px", fontSize: 13, width: "100%", outline: "none" };
const btn = (primary, danger) => ({ ...monoFont, fontSize: 12, cursor: "pointer", borderRadius: 999, padding: "7px 14px", fontWeight: primary ? 700 : 500, color: primary ? "#fff" : danger ? C.flag : C.text, background: primary ? C.mustard : "transparent", border: primary ? "none" : `1px solid ${danger ? alpha(C.flag, 50) : C.line}` });

function Card({ title, children, right }) {
  return (
    <section style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2"><h2 style={{ ...displayFont, fontSize: 15, color: C.text }}>{title}</h2>{right}</div>
      {children}
    </section>
  );
}

export default function ManageCompanyPage({ params }) {
  const { id } = use(params);
  const { user, loading } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const dialog = useDialog();
  const [co, setCo] = useState(null);
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(sp.get("welcome") ? "Your page is live. Add documents and verify your domain to earn trust badges." : sp.get("uploadFailed") ? `These files didn't upload: ${sp.get("uploadFailed")}. Add them below.` : null);
  const [edit, setEdit] = useState(null);
  const [fieldErr, setFieldErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [docType, setDocType] = useState("registration");
  const [domainEmail, setDomainEmail] = useState("");
  const [domainSent, setDomainSent] = useState(false);
  const [code, setCode] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef(null);

  const load = () => api.getCompany(id).then((c) => { setCo(c); setDomainEmail(c.owner?.contactEmail || ""); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); api.getCompanyTerms().then(setMeta).catch(() => {}); }, [id]); // eslint-disable-line

  if (loading || (!co && !err)) return <Loading />;
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!user || !co.isOwner) return <div style={{ ...monoFont, fontSize: 13, color: C.muted }}>Only the page owner can manage this page. <Link href={`/companies/${id}`} style={{ color: C.mustard }}>View page</Link></div>;

  const deleted = !!co.owner.deletedAt;
  const run = async (fn, okMsg) => {
    setBusy(true); setNote(null); setFieldErr({});
    try { const r = await fn(); if (r && r.id) setCo(r); else await load(); if (okMsg) setNote(okMsg); return true; }
    catch (e) { if (e.fields) setFieldErr(e.fields); setNote(e.message); return false; }
    finally { setBusy(false); }
  };
  const startEdit = () => setEdit({ name: co.name, legalName: co.legalName || "", industry: co.industry || "", description: co.description || "", website: co.website || "", headquarters: co.headquarters || "", sizeRange: co.sizeRange || "", foundedYear: co.foundedYear || "", registrationCountry: co.registrationCountry || "", registrationNumber: co.owner.registrationNumber || "", contactEmail: co.owner.contactEmail || "", relationship: co.owner.relationship || "" });
  const save = async () => { if (await run(() => api.updateCompany(id, { ...edit, foundedYear: Number(edit.foundedYear) }), "Saved.")) setEdit(null); };
  const nameLocked = co.owner.nameChangeAvailableAt && new Date(co.owner.nameChangeAvailableAt) > new Date();
  const F = (k, label, props = {}) => (
    <label className="flex flex-col gap-1" key={k}><span style={{ fontSize: 12, color: C.muted }}>{label}</span>
      <input value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} style={{ ...inp, borderColor: fieldErr[k] ? C.flag : C.line }} {...props} />
      {fieldErr[k] && <span style={{ ...monoFont, fontSize: 12, color: C.flag }}>{fieldErr[k]}</span>}</label>
  );

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 760, margin: "0 auto", width: "100%" }}>
      <Link href={`/companies/${id}`} className="flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 12.5 }}><ChevronLeft size={15} /> View public page</Link>
      <div>
        <div className="flex items-center gap-2 flex-wrap"><h1 style={{ ...displayFont, fontSize: 22, color: C.text }}>{co.name}</h1><CompanyBadges co={co} /></div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 4 }}>Page dashboard · only you can see this</div>
      </div>

      {note && <div style={{ background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 35)}`, borderRadius: 12, padding: "10px 14px", fontSize: 13, color: C.text }}>{note}</div>}
      {/* Business plans are optional and separate from registration: say so where the owner lands. */}
      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ minWidth: 220, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Business plans <span style={{ ...monoFont, fontSize: 11, fontWeight: 600, color: C.muted, border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 8px", marginLeft: 6 }}>optional</span></div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginTop: 3 }}>Your page and replying to stories are free. Plans add insights, alerts, benchmarks and more representatives. They never let anyone remove, hide, edit or rank stories.</div>
        </div>
        <Link href={`/companies/${id}/business`} className="lo-tap" style={{ ...monoFont, fontSize: 13, fontWeight: 700, color: "#fff", background: "var(--lo-grad)", borderRadius: 10, padding: "10px 16px", textDecoration: "none", whiteSpace: "nowrap" }}>See plans</Link>
      </div>
      {co.owner.openDisputes > 0 && <div className="flex gap-2" style={{ background: alpha(C.flag, 8), border: `1px solid ${alpha(C.flag, 35)}`, borderRadius: 12, padding: "10px 14px", fontSize: 13, color: C.text }}><AlertTriangle size={16} color={C.flag} style={{ flexShrink: 0, marginTop: 1 }} /> {co.owner.openDisputes} open report{co.owner.openDisputes > 1 ? "s" : ""} on this page are being reviewed.</div>}

      {deleted ? (
        <Card title="This page is deleted">
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>It's hidden from everyone. You can restore it until <b style={{ color: C.text }}>{new Date(new Date(co.owner.deletedAt).getTime() + 30 * 864e5).toLocaleDateString()}</b>, after which it's erased permanently.</p>
          <div className="flex gap-2 flex-wrap"><button disabled={busy} onClick={() => run(() => api.restoreCompany(id), "Restored.")} style={btn(true)} className="flex items-center gap-1.5"><RotateCcw size={13} /> Restore page</button>
            <button disabled={busy} onClick={async () => { if (await dialog.confirm({ title: "Erase this page?", message: "This removes the page and everything on it permanently. It can't be undone.", confirmLabel: "Erase now", danger: true })) run(() => api.deleteCompany(id, true)).then(() => router.push("/companies")); }} style={btn(false, true)} className="flex items-center gap-1.5"><Trash2 size={13} /> Erase now</button></div>
        </Card>
      ) : (<>
        <Card title="Page details" right={!edit && <button onClick={startEdit} style={btn()} className="flex items-center gap-1.5"><Pencil size={12} /> Edit</button>}>
          {!edit ? (
            <dl className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", margin: 0 }}>
              {[["Legal name", co.legalName], ["Industry", co.industry], ["Size", co.sizeRange], ["Founded", co.foundedYear], ["Headquarters", co.headquarters], ["Website", co.website], ["Registered in", co.registrationCountry], ["Registration #", co.owner.registrationNumber], ["Your role", meta?.relationships.find((r) => r.key === co.owner.relationship)?.label], ["Contact email", co.owner.contactEmail]].map(([k, v]) => (
                <div key={k}><dt style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</dt><dd style={{ margin: 0, fontSize: 13, color: C.text, overflowWrap: "anywhere" }}>{v || "—"}</dd></div>
              ))}
              <div style={{ gridColumn: "1 / -1" }}><dt style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Description</dt><dd style={{ margin: 0, fontSize: 13, color: C.text, lineHeight: 1.55 }}>{co.description}</dd></div>
            </dl>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                {F("name", "Company name", { disabled: nameLocked })}
                {F("legalName", "Legal name")}
                <label className="flex flex-col gap-1"><span style={{ fontSize: 12, color: C.muted }}>Industry</span><Select value={edit.industry} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} style={inp}>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select></label>
                <label className="flex flex-col gap-1"><span style={{ fontSize: 12, color: C.muted }}>Size</span><Select value={edit.sizeRange} onChange={(e) => setEdit({ ...edit, sizeRange: e.target.value })} style={inp}>{meta?.sizes.map((s) => <option key={s}>{s}</option>)}</Select></label>
                {F("foundedYear", "Founded", { inputMode: "numeric", maxLength: 4 })}{F("headquarters", "Headquarters")}{F("website", "Website")}{F("registrationCountry", "Registered in")}{F("registrationNumber", "Registration #")}{F("contactEmail", "Contact email")}
              </div>
              {nameLocked && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>The name can next be changed on {new Date(co.owner.nameChangeAvailableAt).toLocaleDateString()}.</div>}
              <label className="flex flex-col gap-1"><span style={{ fontSize: 12, color: C.muted }}>Description</span><textarea rows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ ...inp, resize: "vertical" }} />{fieldErr.description && <span style={{ ...monoFont, fontSize: 12, color: C.flag }}>{fieldErr.description}</span>}</label>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Changing the name, legal name, registration details or website sends a Verified page back for re-review. Every change is logged.</div>
              <div className="flex gap-2"><button disabled={busy} onClick={save} style={btn(true)} className="flex items-center gap-1.5"><Save size={13} /> {busy ? "Saving…" : "Save changes"}</button><button onClick={() => { setEdit(null); setFieldErr({}); }} style={btn()}>Cancel</button></div>
            </div>
          )}
        </Card>

        <Card title="Domain verification" right={co.domainVerified && <span style={{ ...monoFont, fontSize: 12, color: C.corpblue }} className="flex items-center gap-1"><Globe2 size={12} /> Verified</span>}>
          {co.domainVerified ? <p style={{ fontSize: 13, color: C.muted }}>You've proven control of an email at {co.website}.</p> : (<>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>Enter an email at your company's website; we'll send a code to it. This proves you control the domain.</p>
            <div className="flex gap-2 flex-wrap"><input value={domainEmail} onChange={(e) => setDomainEmail(e.target.value)} placeholder="you@company.com" style={{ ...inp, flex: 1, minWidth: 220 }} />
              <button disabled={busy || !domainEmail} onClick={async () => (await run(() => api.sendCompanyDomainCode(id, domainEmail).then(() => null), "Code sent — check that inbox.")) && setDomainSent(true)} style={btn(true)}>Send code</button></div>
            {domainSent && <div className="flex gap-2"><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="6-digit code" inputMode="numeric" style={{ ...inp, maxWidth: 180, letterSpacing: 4 }} />
              <button disabled={busy || code.length !== 6} onClick={() => run(() => api.confirmCompanyDomain(id, code), "Domain verified.")} style={btn(true)}>Confirm</button></div>}
          </>)}
        </Card>

        <Card title="Supporting documents" right={<span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{co.owner.documents.length}/{meta?.limits.maxDocs ?? 6}</span>}>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{co.verification === "verified" ? "Your documents were reviewed and approved." : co.verification === "submitted" ? "Submitted — a reviewer will check them against your details." : co.verification === "rejected" ? `Not approved${co.owner.verificationNote ? `: ${co.owner.verificationNote}` : "."} You can upload different documents.` : "Upload proof to earn the Verified badge. Stored privately; only a reviewer can open them."}</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="flex flex-col gap-2">
            {co.owner.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px" }}>
                <span style={{ minWidth: 0 }}><span style={{ fontSize: 12.5, color: C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.filename}</span><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{meta?.documentTypes.find((t) => t.key === d.docType)?.label} · {new Date(d.createdAt).toLocaleDateString()}</span></span>
                <button disabled={busy} onClick={() => run(() => api.removeCompanyDocument(id, d.id), "Document removed.")} aria-label="Remove" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={15} /></button>
              </li>))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={docType} onChange={(e) => setDocType(e.target.value)} style={{ ...inp, width: "auto", minWidth: 240 }}>{meta?.documentTypes.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select>
            <button disabled={busy} onClick={() => fileRef.current?.click()} style={btn()} className="flex items-center gap-1.5"><FileUp size={13} /> Upload</button>
            <input ref={fileRef} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(() => api.uploadCompanyDocument(id, f, docType), "Uploaded."); }} />
          </div>
        </Card>

        <Card title="Activity log" right={<History size={14} color={C.muted} />}>
          {co.owner.audit.length === 0 ? <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>No activity yet.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>{co.owner.audit.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2" style={{ padding: "7px 0", borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 12.5, color: C.text }}><span>{a.action.replace(/_/g, " ")}</span><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{new Date(a.createdAt).toLocaleString()}</span></li>))}</ul>)}
        </Card>

        <Card title="Delete this page">
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>Hides the page from everyone immediately. You can restore it for 30 days; after that it's erased, along with its documents. You can't edit or remove other people's reviews — they go with the page only when it is erased.</p>
          {!confirmDelete ? <button onClick={() => setConfirmDelete(true)} style={{ ...btn(false, true), alignSelf: "flex-start" }} className="flex items-center gap-1.5"><Trash2 size={13} /> Delete page</button> : (
            <div className="flex gap-2 flex-wrap items-center"><span style={{ fontSize: 13, color: C.text }}>Delete “{co.name}”?</span>
              <button disabled={busy} onClick={() => run(() => api.deleteCompany(id), "Deleted. You can restore it for 30 days.").then(() => setConfirmDelete(false))} style={{ ...btn(true), background: C.flag }}>Yes, delete</button><button onClick={() => setConfirmDelete(false)} style={btn()}>Keep</button></div>)}
        </Card>
      </>)}
    </div>
  );
}
