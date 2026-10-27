"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { card, btn, inputStyle, Pill } from "./ui";
import Select from "@/components/ui/Select";
import { useSubmitLock } from "@/lib/useSubmitLock";

const PLAN_LABEL = { "": "No plan grant", basic: "OUT (basic)", plus: "OUT+", pro: "OUT PRO" };

// Roles & Permissions: every role, every permission, one editor. Saving updates the live role map used by the
// API guard, the admin sections (web + native), and plan features (a role can grant a plan), within seconds.
export default function RolesAdmin() {
  const [data, setData] = useState(null), [err, setErr] = useState(""), [note, setNote] = useState("");
  const [sel, setSel] = useState(null), [draft, setDraft] = useState(null), [q, setQ] = useState("");
  const [onlyOn, setOnlyOn] = useState(false), [open, setOpen] = useState({}), [permForm, setPermForm] = useState(null);
  const { busy, run } = useSubmitLock();

  const load = useCallback(() => adminApi.get("roles").then((d) => { setData(d); setErr(""); return d; }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data) return;
    const r = data.roles.find((x) => x.key === sel) || null;
    setDraft(r ? { ...r, permissions: [...r.permissions], isNew: false } : null);
  }, [sel, data]);

  const groups = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    for (const [key, v] of Object.entries(data.catalog)) { if (!m.has(v.group)) m.set(v.group, []); m.get(v.group).push({ key, ...v }); }
    return [...m.entries()].sort((a, b) => (a[0] === "Custom") - (b[0] === "Custom") || a[0].localeCompare(b[0]));
  }, [data]);

  if (err && !data) return <ErrorNote>{err}</ErrorNote>;
  if (!data) return <Loading />;

  const full = draft?.permissions.includes("*") || draft?.permissions.includes("*admin");
  const has = (k) => draft.permissions.includes(k);
  const toggle = (k) => setDraft((d) => ({ ...d, permissions: d.permissions.includes(k) ? d.permissions.filter((x) => x !== k) : [...d.permissions, k] }));
  const toggleGroup = (items, on) => setDraft((d) => { const s = new Set(d.permissions); items.forEach((i) => (on ? s.add(i.key) : s.delete(i.key))); return { ...d, permissions: [...s] }; });
  const visibleSections = draft ? data.sections.filter((s) => full && draft.permissions.includes("*") ? true : draft.permissions.includes(s.perm) || (draft.permissions.includes("*admin") && s.perm !== "staff.manage" && s.perm !== "roles.manage")) : [];
  const locked = draft?.locked;

  const save = () => run(async () => {
    setErr(""); setNote("");
    try { await adminApi.post("roles/save", { key: draft.key, label: draft.label, description: draft.description, permissions: draft.permissions, planTier: draft.planTier }); setNote("Saved. It applies everywhere within a few seconds."); const d = await load(); if (draft.isNew) setSel(draft.key); return d; }
    catch (e) { setErr(e.message); }
  });
  const remove = () => run(async () => {
    if (!window.confirm(`Delete the role “${draft.label}”?`)) return;
    try { await adminApi.post("roles/delete", { key: draft.key }); setSel(null); setNote("Role deleted."); await load(); } catch (e) { setErr(e.message); }
  });
  const clone = () => setDraft((d) => ({ ...d, key: `${d.key}_copy`.slice(0, 32), label: `${d.label} copy`, isNew: true, system: false, locked: false, members: 0 }));
  const addRole = () => { setSel(null); setDraft({ key: "", label: "", description: "", permissions: ["overview.read"], planTier: "", isNew: true, system: false, locked: false, members: 0 }); };
  const addPerm = () => run(async () => { try { await adminApi.post("roles/permission", permForm); setPermForm(null); setNote("Permission added. Tick it on any role."); await load(); } catch (e) { setErr(e.message); } });
  const delPerm = (key) => run(async () => { if (!window.confirm(`Delete permission ${key}? It is removed from every role.`)) return; try { await adminApi.post("roles/permission-delete", { key }); await load(); } catch (e) { setErr(e.message); } });

  const total = Object.keys(data.catalog).length;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div><h1 style={{ ...displayFont, fontSize: 28, letterSpacing: "-0.02em", margin: 0 }}>Roles &amp; Permissions</h1>
          <div style={{ fontSize: 13.5, color: C.muted, marginTop: 3 }}>{data.roles.length} roles · {total} permissions. Changes are logged and reach the API, web admin, native admin and plan features.</div></div>
        <div style={{ display: "flex", gap: 8 }}><button style={btn("primary")} onClick={addRole}>+ New role</button><button style={btn()} onClick={() => setPermForm({ key: "", label: "", group: "Custom", description: "" })}>+ New permission</button></div>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {note && <div style={{ color: C.green, fontSize: 13.5, margin: "6px 0" }}>{note}</div>}

      {permForm && (
        <div style={{ ...card, marginBottom: 12, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <input style={inputStyle} placeholder="key, e.g. report.escalate" value={permForm.key} onChange={(e) => setPermForm({ ...permForm, key: e.target.value })} />
          <input style={inputStyle} placeholder="Label" value={permForm.label} onChange={(e) => setPermForm({ ...permForm, label: e.target.value })} />
          <input style={inputStyle} placeholder="Group" value={permForm.group} onChange={(e) => setPermForm({ ...permForm, group: e.target.value })} />
          <input style={inputStyle} placeholder="Description (optional)" value={permForm.description} onChange={(e) => setPermForm({ ...permForm, description: e.target.value })} />
          <div style={{ display: "flex", gap: 8 }}><button disabled={busy} style={btn("primary")} onClick={addPerm}>Add permission</button><button style={btn()} onClick={() => setPermForm(null)}>Cancel</button></div>
        </div>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(220px,280px) minmax(0,1fr)", alignItems: "start" }} className="lo-roles-grid">
        <div style={{ ...card, padding: 8 }}>
          {data.roles.map((r) => (
            <button key={r.key} onClick={() => { setSel(r.key); setNote(""); }} style={{ display: "block", width: "100%", textAlign: "left", background: sel === r.key ? "color-mix(in srgb, var(--lo-mustard) 14%, transparent)" : "transparent", border: "none", borderRadius: 10, padding: "9px 10px", cursor: "pointer", color: C.text }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{r.label} {r.locked && <span title="Locked">🔒</span>}</div>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{r.key} · {r.permissions.includes("*") ? "all access" : r.permissions.includes("*admin") ? "admin" : `${r.permissions.length} perms`} · {r.members} member{r.members === 1 ? "" : "s"}{r.planTier ? ` · grants ${r.planTier}` : ""}</div>
            </button>
          ))}
        </div>

        <div style={card}>
          {!draft && <div style={{ color: C.muted, fontSize: 14 }}>Pick a role to see what it can do, or create a new one.</div>}
          {draft && (
            <>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
                <label style={{ fontSize: 12.5, color: C.muted }}>Role key<input style={{ ...inputStyle, opacity: draft.isNew ? 1 : 0.6 }} disabled={!draft.isNew} value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value.toLowerCase() })} placeholder="e.g. community_lead" /></label>
                <label style={{ fontSize: 12.5, color: C.muted }}>Display name<input style={inputStyle} disabled={locked} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
                <label style={{ fontSize: 12.5, color: C.muted }}>Plan this role grants
                  <Select style={inputStyle} disabled={locked} value={draft.planTier} onChange={(e) => setDraft({ ...draft, planTier: e.target.value })}>{Object.entries(PLAN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                </label>
              </div>
              <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 8 }}>Description<input style={inputStyle} disabled={locked} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <div style={{ fontSize: 12.5, color: C.muted, marginTop: 6 }}>A plan grant gives this role that plan&apos;s features everywhere (voice notes, file sharing, AI tools, limits), in addition to anything the person pays for.</div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "14px 0 8px" }}>
                <input style={{ ...inputStyle, maxWidth: 280 }} placeholder={`Search ${total} permissions`} value={q} onChange={(e) => setQ(e.target.value)} />
                <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} /> Granted only</label>
                <span style={{ fontSize: 13, color: C.muted }}>{full ? "Full access" : `${draft.permissions.length} granted`}</span>
              </div>
              {full && <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>This role has {draft.permissions.includes("*") ? "every permission (super admin)" : "all admin permissions"}, so individual boxes are implied.</div>}

              <div style={{ maxHeight: 460, overflow: "auto", border: `1px solid ${C.line}`, borderRadius: 12 }}>
                {groups.map(([g, items]) => {
                  const list = items.filter((i) => (!q || `${i.key} ${i.label}`.toLowerCase().includes(q.toLowerCase())) && (!onlyOn || has(i.key)));
                  if (!list.length) return null;
                  const on = list.filter((i) => has(i.key)).length;
                  const isOpen = open[g] ?? (!!q || g === "Custom");
                  return (
                    <div key={g} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: C.surface2 }}>
                        <button onClick={() => setOpen({ ...open, [g]: !isOpen })} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13.5, color: C.text, flex: 1, textAlign: "left" }}>{isOpen ? "▾" : "▸"} {g} <span style={{ color: C.muted, fontWeight: 500 }}>({on}/{list.length})</span></button>
                        {!locked && <><button style={{ ...btn(), padding: "3px 9px", minHeight: 26, fontSize: 12 }} onClick={() => toggleGroup(list, true)}>All</button><button style={{ ...btn(), padding: "3px 9px", minHeight: 26, fontSize: 12 }} onClick={() => toggleGroup(list, false)}>None</button></>}
                      </div>
                      {isOpen && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: "2px 12px", padding: "8px 12px" }}>
                        {list.map((i) => (
                          <label key={i.key} title={i.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, padding: "3px 0", cursor: locked ? "default" : "pointer" }}>
                            <input type="checkbox" disabled={locked} checked={full || has(i.key)} onChange={() => toggle(i.key)} style={{ marginTop: 3 }} />
                            <span><span style={{ color: C.text }}>{i.label}</span><br /><span style={{ ...monoFont, fontSize: 11.5, color: C.muted }}>{i.key}{i.kind === "core" ? " · used by the app" : ""}</span>
                              {i.kind === "custom" && !locked && <button onClick={(e) => { e.preventDefault(); delPerm(i.key); }} style={{ marginLeft: 6, background: "none", border: "none", color: C.flag, cursor: "pointer", fontSize: 11.5 }}>delete</button>}</span>
                          </label>
                        ))}
                      </div>}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, fontSize: 13 }}><b>Admin sections this role sees ({visibleSections.length}):</b>{" "}
                <span style={{ color: C.muted }}>{visibleSections.map((s) => s.label).join(" · ") || "none"}</span></div>

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                {!locked && <button disabled={busy || !draft.key || !draft.label} style={btn("primary")} onClick={save}>{draft.isNew ? "Create role" : "Save changes"}</button>}
                {!draft.isNew && <button style={btn()} onClick={clone}>Duplicate</button>}
                {!draft.isNew && !draft.system && <button disabled={busy} style={btn("danger")} onClick={remove}>Delete role</button>}
                {locked && <Pill>locked</Pill>}
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@media (max-width: 820px){ .lo-roles-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
