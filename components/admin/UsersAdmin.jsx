"use client";
import { LiveDot } from "@/components/admin/ui";
import Loading from "@/components/ui/Loading";
import { useSearchParams } from "next/navigation";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState, useCallback } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { Pill, Stat, card, btn, inputStyle } from "./ui";
import { Modal } from "./SectionTable";
import { useAdmin } from "./AdminContext";
import Select from "@/components/ui/Select";

export default function UsersAdmin() {
  const me = useAdmin();
  const [q, setQ] = useState(""), [status, setStatus] = useState("");
  const [rows, setRows] = useState(null), [pii, setPii] = useState(false), [err, setErr] = useState("");
  const [sel, setSel] = useState(null);
  const sp = useSearchParams();
  useEffect(() => { const o = sp.get("open"); if (o) setSel(o); }, [sp]);

  const load = useCallback(() => adminApi.get(`users?q=${encodeURIComponent(q)}&status=${status}`).then((d) => { setRows(d.users); setPii(d.canPII); setErr(""); }).catch((e) => setErr(e.message)), [q, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <h1 style={{ ...displayFont, fontSize: 24, margin: "0 0 12px" }}>Users & Members</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, maxWidth: 340 }} placeholder={pii ? "Search handle, email, name or ID" : "Search handle or ID"} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select style={{ ...inputStyle, width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{["active", "locked", "suspended", "banned"].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr>{["Handle", ...(pii ? ["Email"] : []), "Status", "Plan", "Verified", "Restrictions", "Joined", "Last seen"].map((h) => <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 12, color: C.muted, textTransform: "uppercase", borderBottom: `1px solid ${C.line}` }}>{h}</th>)}</tr></thead>
          <tbody>
            {(rows || []).map((u) => (
              <tr key={u.id} onClick={() => setSel(u.id)} style={{ cursor: "pointer", borderBottom: `1px solid ${C.line}` }}>
                <td style={{ padding: "8px 12px" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><LiveDot off={!u.online} />{u.pseudonym}</span>{u.role !== "user" && <span style={{ ...monoFont, fontSize: 12, color: C.corpblue }}> · {u.role}</span>}</td>
                {pii && <td style={{ padding: "8px 12px" }}>{u.email}</td>}
                <td style={{ padding: "8px 12px" }}><Pill>{u.status}</Pill></td>
                <td style={{ padding: "8px 12px" }}>{u.tier}</td>
                <td style={{ padding: "8px 12px" }}>{u.emailVerified ? "✉️" : "—"} {u.phoneVerified ? "📱" : ""} {u.idStatus === "verified" ? "🪪" : ""}</td>
                <td style={{ padding: "8px 12px", fontSize: 12 }}>{u.restrictions.join(", ") || "—"}</td>
                <td style={{ padding: "8px 12px" }}>{u.createdAt?.slice(0, 10)}</td>
                <td style={{ padding: "8px 12px" }}>{u.online ? <b style={{ color: C.green }}>Active now</b> : u.lastSeenAt?.slice(0, 16).replace("T", " ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 && <p style={{ padding: 20, color: C.muted, textAlign: "center" }}>No users match.</p>}
      </div>
      {sel && <UserDrawer id={sel} me={me} onClose={() => { setSel(null); load(); }} />}
    </div>
  );
}

function UserDrawer({ id, me, onClose }) {
  const [u, setU] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(null), [reason, setReason] = useState(""), [days, setDays] = useState(7), [priv, setPriv] = useState("vent_rooms");
  const load = useCallback(() => adminApi.get(`users/${id}`).then(setU).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const canEnforce = me.permissions.includes("*") || me.permissions.includes("users.enforce");
  const canSevere = me.permissions.includes("*") || me.permissions.includes("users.enforce.severe");

  async function submit() {
    setBusy(true); setErr("");
    try { await adminApi.post(`users/${id}/enforce`, { action: pick, reason, days, privilege: priv }); setPick(null); setReason(""); await load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const row = (k, v) => v != null && v !== "" && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span style={{ color: C.muted }}>{k}</span><span>{String(v)}</span></div>;

  return (
    <Modal wide title={u ? u.pseudonym : "User"} onClose={onClose}>
      {!u ? (err ? <ErrorNote>{err}</ErrorNote> : <Loading />) : (
        <>
          <div style={{ marginBottom: 10 }}><Pill>{u.status}</Pill> {u.label && <Pill>{u.label}</Pill>} {u.statusUntil && <span style={{ fontSize: 12, color: C.muted }}>until {u.statusUntil.slice(0, 10)}</span>}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <Stat label="Posts" value={u.posts} /><Stat label="Followers" value={u.followers} /><Stat label="Open reports" value={u.openReportsAgainst} tone={u.openReportsAgainst ? C.flag : undefined} />
          </div>
          {row("Email", u.email)}{row("Real name", u.realName)}{row("Phone", u.phone)}
          {row("Role", u.role)}{row("Plan", `${u.tier}${u.subscriptionStatus ? ` (${u.subscriptionStatus})` : ""}`)}{row("Country", u.country)}
          {row("Email verified", u.emailVerified ? "yes" : "no")}{row("Phone verified", u.phoneVerified ? "yes" : "no")}
          {row("ID / Business / Professional", `${u.idStatus} / ${u.businessStatus} / ${u.professionalStatus}`)}
          {row("Restrictions", u.restrictions.join(", ") || "none")}{row("Joined", u.createdAt?.slice(0, 10))}{row("Last seen", u.lastSeenAt?.slice(0, 16).replace("T", " "))}
          {row("Anonymous identities", u.identities)}
          {!u.email && <p style={{ fontSize: 12, color: C.muted }}>Real identity details are hidden for your role. Unmasking an anonymous author requires the two-person break-glass process.</p>}

          {canEnforce && (
            <>
              <h3 style={{ margin: "16px 0 8px", fontSize: 14 }}>Enforcement</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(me.enforcementActions).map(([k, def]) => (
                  <button key={k} disabled={def.severe && !canSevere} style={{ ...btn(def.severe ? "danger" : pick === k ? "primary" : undefined), textAlign: "left", opacity: def.severe && !canSevere ? 0.4 : 1 }} onClick={() => setPick(k)}>{def.label}</button>
                ))}
              </div>
              {pick && (
                <div style={{ ...card, marginTop: 10 }}>
                  <b style={{ fontSize: 13 }}>{me.enforcementActions[pick].label}</b>
                  <textarea rows={2} style={{ ...inputStyle, marginTop: 8 }} placeholder="Reason (required, shown to the user)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  {me.enforcementActions[pick].timed && <label style={{ fontSize: 12, color: C.muted }}>Duration (days) <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} style={{ ...inputStyle, width: 90, marginLeft: 6 }} /></label>}
                  {pick === "remove_privilege" && <Select style={{ ...inputStyle, marginTop: 8 }} value={priv} onChange={(e) => setPriv(e.target.value)}><option value="vent_rooms">Create Vent Rooms</option><option value="company_pages">Create company pages</option></Select>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                    <button style={btn()} onClick={() => setPick(null)}>Cancel</button>
                    <button style={btn("primary")} disabled={busy || !reason.trim()} onClick={submit}>Apply</button>
                  </div>
                </div>
              )}
            </>
          )}
          {(me.permissions.includes("*") || me.permissions.includes("gates.bypass")) && (
            <>
              <h3 style={{ margin: "16px 0 8px", fontSize: 14 }}>Plan (testing)</h3>
              <div style={{ display: "flex", gap: 6 }}>
                {["basic", "plus", "pro"].map((t) => <button key={t} style={btn(u.tier === t ? "primary" : undefined)} onClick={async () => { try { await adminApi.post(`users/${id}/plan`, { tier: t }); await load(); } catch (e) { setErr(e.message); } }}>{t}</button>)}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {[["business", "Business"], ["business_pro", "Business Pro"], ["enterprise", "Enterprise"]].map(([t, l]) => <button key={t} style={btn()} onClick={async () => { try { const r = await adminApi.post(`users/${id}/plan`, { tier: t }); setErr(`${l} set on: ${(r.companies || []).join(", ")}`); } catch (e) { setErr(e.message); } }}>{l}</button>)}
              </div>
              <p style={{ fontSize: 12, color: C.muted }}>Sets the plan directly, with no payment. Audit-logged. Business plans belong to a company page, so this applies to every company page this user owns (they need one first).</p>
            </>
          )}
          {err && <ErrorNote>{err}</ErrorNote>}
          <h3 style={{ margin: "16px 0 8px", fontSize: 14 }}>Enforcement history</h3>
          {u.enforcements.length === 0 ? <p style={{ color: C.muted, fontSize: 13 }}>No enforcement on record.</p> : u.enforcements.map((e) => (
            <div key={e.id} style={{ borderTop: `1px solid ${C.line}`, padding: "6px 0", fontSize: 13 }}>
              <b>{me.enforcementActions[e.action]?.label || e.action}</b> <span style={{ color: C.muted }}>· {e.created_at.slice(0, 10)} · {e.issued_by}{e.revoked_at ? " · revoked" : ""}</span>
              <div style={{ color: C.muted }}>{e.reason}</div>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
