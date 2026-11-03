"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState } from "react";
import { C, monoFont, displayFont } from "@/lib/theme";
import Select from "@/components/ui/Select";

// Shared shell for the public DMCA / legal request forms (same look as the
// login / forgot-password pages).
export default function PublicForm({ title, intro, endpoint, fields, checks, submitLabel }) {
  const [v, setV] = useState({}), [busy, setBusy] = useState(false), [err, setErr] = useState(null), [ref, setRef] = useState(null);
  const input = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "10px 12px", fontSize: 13.5, width: "100%" };
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't submit. Try again.");
      setRef(d.reference);
    } catch (er) { setErr(er.message); } finally { setBusy(false); }
  }
  if (ref) return (
    <div className="flex flex-col gap-3" style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22 }}>Received</div>
      <div style={{ color: C.muted, fontSize: 14 }}>Your submission was recorded. Reference <b style={{ ...monoFont, color: C.text }}>{ref}</b>. We'll contact you at the email you provided if we need anything else.</div>
    </div>
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" style={{ maxWidth: 520, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22 }}>{title}</div>
      <div style={{ color: C.muted, fontSize: 13.5, lineHeight: 1.5 }}>{intro}</div>
      {fields.map((f) => (
        <label key={f.key} style={{ ...monoFont, fontSize: 12, color: C.muted, display: "grid", gap: 4 }}>{f.label}{f.optional ? " (optional)" : ""}
          {f.options ? <Select style={input} value={v[f.key] || ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}><option value="">Select…</option>{f.options.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</Select>
            : f.long ? <textarea rows={4} style={input} value={v[f.key] || ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
            : <input style={input} type={f.type || "text"} placeholder={f.placeholder} value={v[f.key] || ""} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />}
        </label>
      ))}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px", height: 0, opacity: 0 }} value={v.website || ""} onChange={(e) => setV({ ...v, website: e.target.value })} />
      {checks.map((c) => (
        <label key={c.key} style={{ display: "flex", gap: 8, fontSize: 12.5, color: C.text, alignItems: "flex-start" }}>
          <input type="checkbox" checked={!!v[c.key]} onChange={(e) => setV({ ...v, [c.key]: e.target.checked })} style={{ marginTop: 3 }} />{c.label}
        </label>
      ))}
      {err && <ErrorNote>{err}</ErrorNote>}
      <button type="submit" disabled={busy} style={{ ...monoFont, fontSize: 12.5, color: "#fff", background: C.mustard, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}>{busy ? "Submitting…" : submitLabel}</button>
    </form>
  );
}
