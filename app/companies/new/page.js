"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Check, FileUp, X, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";
import { useAuth } from "@/app/auth-provider";
import { INDUSTRIES } from "@/lib/data";
import Select from "@/components/ui/Select";

const STEPS = ["Company", "Registration", "Documents", "Terms & confirm"];
const input = (err) => ({ background: C.surface2, border: `1px solid ${err ? C.flag : C.line}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 13.5, width: "100%", outline: "none" });

function Field({ label, hint, error, children }) {
  return (
    <label className="flex flex-col gap-1.5" style={{ minWidth: 0 }}>
      <span style={{ fontSize: 12.5, color: C.text, fontWeight: 600 }}>{label}</span>
      {children}
      {error ? <ErrorNote>{error}</ErrorNote> : hint ? <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{hint}</span> : null}
    </label>
  );
}

export default function NewCompanyPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [meta, setMeta] = useState(null);
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", legalName: "", industry: "", sizeRange: "", foundedYear: "", headquarters: "", website: "", description: "", registrationCountry: "", registrationNumber: "", relationship: "", contactEmail: "" });
  const [files, setFiles] = useState([]); // { file, docType }
  const [decl, setDecl] = useState({});
  const [confirmName, setConfirmName] = useState("");
  const [readTerms, setReadTerms] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const termsRef = useRef(null);
  const fileRef = useRef(null);
  const [pickType, setPickType] = useState("registration");

  useEffect(() => { api.getCompanyTerms().then(setMeta).catch((e) => setError(e.message)); }, []);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); if (errors[k]) setErrors({ ...errors, [k]: undefined }); };

  const FIELD_LABELS = { name: 'Company name', legalName: 'Legal name', industry: 'Industry', sizeRange: 'Company size', foundedYear: 'Year founded', website: 'Website', description: 'Description (60+ characters)', registrationCountry: 'Country of registration', registrationNumber: 'Registration number', relationship: 'Your relationship', contactEmail: 'Contact email' };
  function problems(n) {
    const e = {};
    if (n === 0) {
      if (f.name.trim().length < 2) e.name = "Enter the company's name.";
      if (f.legalName.trim().length < 2) e.legalName = "Enter the registered legal name.";
      if (!f.industry) e.industry = "Choose an industry.";
      if (!f.sizeRange) e.sizeRange = "Choose a size.";
      const y = Number(f.foundedYear); if (!(y >= 1800 && y <= new Date().getFullYear())) e.foundedYear = "Enter a valid year.";
      if (!/^(https?:\/\/)?[^\s/]+\.[^\s/]+/.test(f.website.trim())) e.website = "Enter the company's website.";
      if (f.description.trim().length < 60) e.description = `Describe the company in at least 60 characters (${f.description.trim().length} so far).`;
    }
    if (n === 1) {
      if (!f.registrationCountry.trim()) e.registrationCountry = "Enter the country of registration.";
      if (f.registrationNumber.trim().length < 4) e.registrationNumber = "Enter the registration / tax number.";
      if (!f.relationship) e.relationship = "Choose your relationship.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.contactEmail.trim())) e.contactEmail = "Enter a valid contact email.";
    }
    return e;
  }
  function validateStep(n) { const e = problems(n); setErrors(e); return Object.keys(e).length === 0; }
  const missingNow = step < 3 ? Object.keys(problems(step)) : [];
  const next = () => { if (validateStep(step)) setStep(step + 1); };

  function addFile(e) {
    const picked = [...(e.target.files || [])];
    e.target.value = "";
    const ok = picked.filter((p) => ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(p.type) && p.size <= 10 * 1024 * 1024);
    if (ok.length !== picked.length) setError("Some files were skipped — use PDF/PNG/JPEG/WebP under 10MB.");
    setFiles((cur) => [...cur, ...ok.map((file) => ({ file, docType: pickType }))].slice(0, meta?.limits.maxDocs || 6));
  }

  async function submit() {
    setBusy(true); setError(null);
    try {
      const company = await api.createCompany({ ...f, foundedYear: Number(f.foundedYear), declarations: decl, confirmName, mode: "alias" });
      const failed = [];
      for (const { file, docType } of files) {
        try { await api.uploadCompanyDocument(company.id, file, docType); } catch (e) { failed.push(file.name); }
      }
      router.push(`/companies/${company.id}/manage${failed.length ? `?uploadFailed=${encodeURIComponent(failed.join(", "))}` : "?welcome=1"}`);
    } catch (e) {
      if (e.fields) { setErrors(e.fields); const first = Object.keys(e.fields)[0]; setStep(["name", "legalName", "industry", "sizeRange", "foundedYear", "website", "description"].includes(first) ? 0 : 1); }
      setError(e.code === "DUPLICATE" && e.body?.existingId ? <>A page for this company already exists. <Link href={`/companies/${e.body.existingId}`} style={{ color: C.mustard }}>Open it</Link>.</> : e.message);
    } finally { setBusy(false); }
  }

  if (loading || !meta) return <Loading />;
  if (!user) return <div style={{ ...monoFont, fontSize: 13, color: C.muted }}>Log in to register a company. <Link href="/login" style={{ color: C.mustard }}>Log in</Link></div>;

  const gateMissing = [!user.emailVerified && "email", !user.phoneVerified && "phone number"].filter(Boolean);
  const termsOk = readTerms && meta.declarations.every((d) => decl[d.key]) && confirmName.trim().toLowerCase() === f.name.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-5" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
      <Link href="/companies" className="flex items-center gap-1" style={{ color: C.muted, textDecoration: "none", fontSize: 12.5 }}><ChevronLeft size={15} /> Companies</Link>
      <div>
        <h1 style={{ ...displayFont, fontSize: 24, color: C.text }}>Register a company</h1>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>Company pages are public and carry legal weight, so we ask for real details and keep a record of who registered what. Takes about five minutes.</p>
      </div>

      {gateMissing.length > 0 && (
        <div className="flex gap-3" style={{ background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 40)}`, borderRadius: 12, padding: 14 }}>
          <AlertTriangle size={18} color={C.mustard} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.5 }}>Verify your {gateMissing.join(" and ")} before registering a company. <Link href="/settings#privacy" style={{ color: C.mustard }}>Go to settings</Link></div>
        </div>
      )}

      {/* stepper */}
      <ol className="flex items-center gap-2" style={{ listStyle: "none", padding: 0, margin: 0, overflowX: "auto" }}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: i < step ? C.green : i === step ? C.mustard : C.surface2, color: i <= step ? "#fff" : C.muted, border: `1px solid ${i <= step ? "transparent" : C.line}` }}>{i < step ? <Check size={14} /> : i + 1}</span>
            <span style={{ fontSize: 12.5, color: i === step ? C.text : C.muted, fontWeight: i === step ? 700 : 400 }}>{s}</span>
            {i < STEPS.length - 1 && <span style={{ width: 18, height: 1, background: C.line }} />}
          </li>
        ))}
      </ol>

      <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 }} className="p-5 flex flex-col gap-4">
        {step === 0 && (<>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Field label="Company name" hint="The name people know it by." error={errors.name}><input value={f.name} onChange={set("name")} maxLength={80} style={input(errors.name)} /></Field>
            <Field label="Registered legal name" hint="Exactly as on the registration certificate." error={errors.legalName}><input value={f.legalName} onChange={set("legalName")} maxLength={140} style={input(errors.legalName)} /></Field>
            <Field label="Industry" error={errors.industry}>
              <Select value={f.industry} onChange={set("industry")} style={input(errors.industry)}><option value="">Select…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</Select>
            </Field>
            <Field label="Company size" error={errors.sizeRange}>
              <Select value={f.sizeRange} onChange={set("sizeRange")} style={input(errors.sizeRange)}><option value="">Select…</option>{meta.sizes.map((s) => <option key={s}>{s}</option>)}</Select>
            </Field>
            <Field label="Year founded" error={errors.foundedYear}><input value={f.foundedYear} onChange={set("foundedYear")} inputMode="numeric" maxLength={4} style={input(errors.foundedYear)} /></Field>
            <Field label="Headquarters" hint="City, country (optional)"><input value={f.headquarters} onChange={set("headquarters")} maxLength={80} style={input()} /></Field>
          </div>
          <Field label="Website" hint="Used to verify you actually represent this company." error={errors.website}><input value={f.website} onChange={set("website")} placeholder="https://acme.com" style={input(errors.website)} /></Field>
          <Field label="What does the company do?" error={errors.description} hint={`${f.description.trim().length}/1200`}>
            <textarea value={f.description} onChange={set("description")} rows={4} maxLength={1200} style={{ ...input(errors.description), resize: "vertical" }} />
          </Field>
        </>)}

        {step === 1 && (<>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <Field label="Country of registration" error={errors.registrationCountry}><input value={f.registrationCountry} onChange={set("registrationCountry")} maxLength={60} style={input(errors.registrationCountry)} /></Field>
            <Field label="Registration / tax number" hint="Kept private; used for duplicate checks and review." error={errors.registrationNumber}><input value={f.registrationNumber} onChange={set("registrationNumber")} maxLength={60} style={input(errors.registrationNumber)} /></Field>
            <Field label="Your relationship to the company" error={errors.relationship}>
              <Select value={f.relationship} onChange={set("relationship")} style={input(errors.relationship)}><option value="">Select…</option>{meta.relationships.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>
            </Field>
            <Field label="Contact email" hint="Use an address at the company's domain to earn the Domain-verified badge." error={errors.contactEmail}><input value={f.contactEmail} onChange={set("contactEmail")} type="email" style={input(errors.contactEmail)} /></Field>
          </div>
          <div className="flex gap-2" style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.5 }}><ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 1 }} /> Your registration number and email are never shown publicly. Your identity stays behind your alias.</div>
        </>)}

        {step === 2 && (<>
          <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>Supporting documents are optional but they're how a page earns the <b>Verified</b> badge. They're stored privately and only a reviewer can open them.</div>
          <div className="flex items-end gap-2 flex-wrap">
            <Field label="Document type"><Select value={pickType} onChange={(e) => setPickType(e.target.value)} style={{ ...input(), width: "auto", minWidth: 260 }}>{meta.documentTypes.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</Select></Field>
            <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px dashed ${alpha(C.mustard, 60)}`, background: alpha(C.mustard, 6), borderRadius: 10, padding: "10px 14px", cursor: "pointer" }}><FileUp size={14} /> Add file</button>
            <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" multiple hidden onChange={addFile} />
          </div>
          {files.length === 0 ? <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>No documents added. You can add them later from the page dashboard.</div> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="flex flex-col gap-2">
              {files.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-2" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 12px" }}>
                  <span style={{ minWidth: 0 }}><span style={{ fontSize: 12.5, color: C.text, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.file.name}</span><span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{meta.documentTypes.find((d) => d.key === x.docType)?.label} · {(x.file.size / 1024).toFixed(0)} KB</span></span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove" style={{ background: "none", border: "none", color: C.muted, cursor: "pointer" }}><X size={15} /></button>
                </li>
              ))}
            </ul>
          )}
        </>)}

        {step === 3 && (<>
          <div style={{ background: alpha(C.corpblue, 8), border: `1px solid ${alpha(C.corpblue, 30)}`, borderRadius: 12, padding: "10px 14px", fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>Registering a company page is free. Optional business plans (insights, alerts, benchmarks, extra representatives) are offered after you register, from your company console. A plan never changes which stories are shown.</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>Company Page Terms <span style={{ ...monoFont, fontSize: 12, color: C.muted, fontWeight: 400 }}>v{meta.version}</span></div>
            <div ref={termsRef} onScroll={(e) => { const t = e.currentTarget; if (t.scrollTop + t.clientHeight >= t.scrollHeight - 12) setReadTerms(true); }} tabIndex={0}
              style={{ maxHeight: 240, overflowY: "auto", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              {meta.terms.map((t) => (<div key={t.title} style={{ marginBottom: 12 }}><div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{t.title}</div><p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, marginTop: 2 }}>{t.body}</p></div>))}
            </div>
            {!readTerms && <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 6 }}>Scroll to the bottom to continue.</div>}
          </div>
          <div className="flex flex-col gap-2.5" style={{ opacity: readTerms ? 1 : 0.45, pointerEvents: readTerms ? "auto" : "none" }}>
            {meta.declarations.map((d) => (
              <label key={d.key} className="flex items-start gap-2.5" style={{ cursor: "pointer", fontSize: 13, color: C.text, lineHeight: 1.45 }}>
                <input type="checkbox" checked={!!decl[d.key]} onChange={(e) => setDecl({ ...decl, [d.key]: e.target.checked })} style={{ marginTop: 3, accentColor: C.mustard }} /> {d.text}
              </label>
            ))}
            <Field label={`Type “${f.name || "the company name"}” to confirm`}><input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} style={input()} /></Field>
          </div>
        </>)}

        {error && <ErrorNote>{error}</ErrorNote>}

        {step < 3 && missingNow.length > 0 && <div role="status" style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, border: `1px dashed ${C.line}`, borderRadius: 10, padding: "8px 12px" }}><b style={{ color: C.text }}>Still needed to continue:</b> {missingNow.map((k) => FIELD_LABELS[k] || k).join(", ")}</div>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={() => { setStep(step - 1); setError(null); }} disabled={step === 0 || busy} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "8px 16px", cursor: step === 0 ? "default" : "pointer", opacity: step === 0 ? 0.4 : 1 }}>Back</button>
          {step < 3 ? (
            <button onClick={next} disabled={gateMissing.length > 0 || missingNow.length > 0} title={missingNow.length ? "Complete the required fields first" : undefined} className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.mustard, border: "none", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", opacity: gateMissing.length || missingNow.length ? 0.5 : 1 }}>Continue <ChevronRight size={14} /></button>
          ) : (
            <button onClick={submit} disabled={!termsOk || busy} className="flex items-center gap-1.5 lo-tap" style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.mustard, border: "none", borderRadius: 10, padding: "9px 18px", fontWeight: 700, cursor: "pointer", opacity: !termsOk || busy ? 0.5 : 1 }}>{busy ? <><Loader2 size={14} className="lo-spin" /> Registering…</> : "Register company"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
