"use client";
import Loading from "@/components/ui/Loading";
import { useSearchParams } from "next/navigation";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import NetworkGraph from "./NetworkGraph";
import { Stat, Pill, card, btn, inputStyle } from "./ui";
import Select from "@/components/ui/Select";

const PILL_COLS = new Set(["status", "state", "visibility", "verification", "review", "priority", "role", "locked", "plan", "sla", "severity", "event"]);
const PAGE = 25;
const optVal = (o) => (Array.isArray(o) ? o[0] : o);
const optLab = (o) => (Array.isArray(o) ? o[1] : o);
// An action is shown when every key in its `when` matches the row ("*" = has a real value).
const shows = (a, r) => !a.when || Object.entries(a.when).every(([k, vals]) => vals.includes("*") ? r[k] && r[k] !== "—" : vals.includes(String(r[k])));

// Renders ANY /api/admin/<section> response: summary stats, filter chips, search,
// sortable + paginated table, row actions (confirm / reason / multi-field edit),
// an "add" form, CSV export and an optional graph.
export default function SectionTable({ id, title }) {
  const [data, setData] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [q, setQ] = useState(""), [chip, setChip] = useState("all"), [sort, setSort] = useState(null), [page, setPage] = useState(0);
  const [prompt, setPrompt] = useState(null), [val, setVal] = useState(""), [form, setForm] = useState(null);

  const load = useCallback(() => adminApi.get(id).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { setData(null);  setChip("all"); setSort(null); setPage(0); load(); }, [load]);
  const sp = useSearchParams();
  // Follows ?q= so a global-search hit filters this table even when you are already on it.
  useEffect(() => { setQ(sp.get("q") || ""); }, [sp]);
  useEffect(() => setPage(0), [q, chip, sort]);

  const chips = useMemo(() => (data?.chips ? [...new Set(data.rows.map((r) => String(r[data.chips] ?? "")).filter(Boolean))] : []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    let r = data.rows;
    if (chip !== "all") r = r.filter((x) => String(x[data.chips]) === chip);
    if (q.trim()) { const s = q.toLowerCase(); r = r.filter((x) => data.columns.some((c) => String(x[c.key] ?? "").toLowerCase().includes(s)) || String(x.id).toLowerCase().includes(s)); }
    if (sort) r = [...r].sort((a, b) => { const x = a[sort.key], y = b[sort.key]; const n = typeof x === "number" && typeof y === "number"; const c = n ? x - y : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }); return sort.dir === "asc" ? c : -c; });
    return r;
  }, [data, q, chip, sort]);

  async function run(row, action, body) {
    setBusy(true); setErr("");
    try {
      const out = await adminApi.post(`${id}/${encodeURIComponent(row.id)}/${action.id}`, body || {});
      if (out.url) window.open(out.url, "_blank", "noopener");
      setPrompt(null); setForm(null); setVal(""); await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function click(row, a) {
    if (a.form) setForm({ row, a, v: { ...(row._form || {}) }, fields: a.form, title: a.label });
    else if (a.input) { setPrompt({ row, a }); setVal(a.input.options?.length ? optVal(a.input.options[0]) : ""); }
    else run(row, a);
  }
  function exportCsv() {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [data.columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => data.columns.map((c) => esc(r[c.key])).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${id}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  if (err && !data) return <ErrorNote>{err}</ErrorNote>;
  if (!data) return <div><div className="lo-progress" /><Loading variant="list" rows={8} /></div>;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const th = { textAlign: "left", padding: "12px 14px", fontSize: 11.5, fontWeight: 750, letterSpacing: "0.07em", textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.line2}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: C.surface, zIndex: 1 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.025em", color: C.text }}>{title}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {data.create && <button style={btn("primary")} onClick={() => setForm({ fields: data.create, v: {}, create: true, title: data.createLabel?.replace(/^\+\s*/, "") || "Add" })}>{data.createLabel || "+ Add"}</button>}
          <button style={btn()} onClick={exportCsv}>Export CSV</button>
          <button style={btn()} onClick={load}>Refresh</button>
        </div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {data.summary?.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 14 }}>
          {data.summary.map(([l, v]) => <Stat key={l} label={l} value={v} />)}
        </div>
      )}
      {data.graph && <NetworkGraph graph={data.graph} />}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input placeholder={`Search ${rows.length === data.rows.length ? data.rows.length : rows.length + " of " + data.rows.length} rows…`} value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, maxWidth: 320 }} />
        {chips.length > 1 && ["all", ...chips].map((c) => <button key={c} onClick={() => setChip(c)} style={{ ...btn(chip === c ? "primary" : undefined), borderRadius: 8, padding: "5px 12px", textTransform: "capitalize" }}>{c}</button>)}
      </div>
      <div style={{ ...card, overflow: "auto", padding: 0, maxHeight: "68vh" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr>
            {data.columns.map((c) => <th key={c.key} style={{ ...th, cursor: "pointer" }} onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === "asc" ? { key: c.key, dir: "desc" } : null) : { key: c.key, dir: "asc" }))}>{c.label}{sort?.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</th>)}
            {data.actions?.length > 0 && <th style={th} />}
          </tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={data.columns.length + 1} style={{ padding: 40, color: C.muted, textAlign: "center", fontSize: 14.5 }}>{data.rows.length ? "No rows match your filters." : "Nothing here yet."}</td></tr>}
            {shown.map((r) => {
              const acts = (data.actions || []).filter((a) => shows(a, r) && !(data.pendingOnly?.includes(a.id) && ["approved", "rejected", "accepted", "actioned", "dismissed", "resolved", "complied", "contested", "takedown", "closed"].includes(String(r.status))));
              return (
                <tr key={r.id} className="lo-row-hover" style={{ borderBottom: `1px solid ${C.line}` }}>
                  {data.columns.map((c, ci) => <td key={c.key} style={{ padding: "11px 14px", maxWidth: 360, verticalAlign: "top", whiteSpace: ["copy", "text", "subject", "details", "message", "body"].includes(c.key) ? "normal" : "nowrap" }}>{PILL_COLS.has(c.key) && r[c.key] ? <Pill>{r[c.key]}</Pill> : data.detail && ci === 0 ? <Link href={`/admin/${id}/${encodeURIComponent(r.id)}`} style={{ color: C.corpblue, textDecoration: "none", fontWeight: 600 }}>{String(r[c.key] ?? "—")}</Link> : typeof r[c.key] === "number" ? r[c.key].toLocaleString() : String(r[c.key] ?? "")}</td>)}
                  {data.actions?.length > 0 && (
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap", textAlign: "right" }}>
                      {acts.map((a) => <button key={a.id + a.label} disabled={busy} style={{ ...btn(a.danger ? "danger" : undefined), marginLeft: 6 }} onClick={() => click(r, a)}>{a.label}</button>)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, ...monoFont, fontSize: 12, color: C.muted }}>
          <span>{rows.length.toLocaleString()} rows · page {page + 1} of {pages}</span>
          <span style={{ display: "flex", gap: 6 }}><button style={btn()} disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button><button style={btn()} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next →</button></span>
        </div>
      )}

      {prompt && (
        <Modal onClose={() => setPrompt(null)} title={prompt.a.label.replace("…", "")}>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>{prompt.a.input.label}</div>
          {prompt.a.input.options?.length ? <Select value={val} onChange={(e) => setVal(e.target.value)} style={inputStyle}>{prompt.a.input.options.map((o) => <option key={optVal(o)} value={optVal(o)}>{optLab(o)}</option>)}</Select>
            : <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} style={inputStyle} />}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button style={btn()} onClick={() => setPrompt(null)}>Cancel</button>
            <button style={btn(prompt.a.danger ? "danger" : "primary")} disabled={busy || (!val && !prompt.a.input.optional)} onClick={() => run(prompt.row, prompt.a, { [prompt.a.input.key]: val })}>Confirm</button>
          </div>
        </Modal>
      )}
      {form && (
        <Modal onClose={() => setForm(null)} title={form.title} wide>
          <FormFields fields={form.fields} v={form.v} set={(v) => setForm({ ...form, v })} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button style={btn()} onClick={() => setForm(null)}>Cancel</button>
            <button style={btn("primary")} disabled={busy} onClick={async () => {
              if (!form.create) return run(form.row, form.a, form.v);
              setBusy(true); setErr("");
              try { await adminApi.post(`${id}/create`, form.v); setForm(null); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
            }}>{form.create ? "Create" : "Save"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function FormFields({ fields, v, set }) {
  return fields.map((f) => (
    <label key={f.key} style={{ display: "block", marginBottom: 10, fontSize: 12, color: C.muted }}>{f.label}{f.optional ? " (optional)" : ""}
      {f.options ? <Select style={{ ...inputStyle, marginTop: 4 }} value={v[f.key] || ""} onChange={(e) => set({ ...v, [f.key]: e.target.value })}><option value="">Select…</option>{f.options.map((o) => <option key={optVal(o)} value={optVal(o)}>{optLab(o)}</option>)}</Select>
        : f.long ? <textarea rows={3} style={{ ...inputStyle, marginTop: 4 }} value={v[f.key] || ""} onChange={(e) => set({ ...v, [f.key]: e.target.value })} />
        : <input style={{ ...inputStyle, marginTop: 4 }} value={v[f.key] || ""} onChange={(e) => set({ ...v, [f.key]: e.target.value })} />}
    </label>
  ));
}

export function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#000a", zIndex: 80, display: "flex", justifyContent: wide ? "flex-end" : "center", alignItems: wide ? "stretch" : "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: wide ? 0 : 14, padding: 18, width: wide ? "min(480px,100%)" : "min(440px,92%)", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><b style={{ fontSize: 16 }}>{title}</b><button onClick={onClose} style={{ ...btn(), border: 0 }}>✕</button></div>
        {children}
      </div>
    </div>
  );
}
