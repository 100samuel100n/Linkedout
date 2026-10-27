"use client";
import { useCallback, useEffect, useState } from "react";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import Select from "@/components/ui/Select";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { card, btn, inputStyle, Stat, Pill } from "./ui";
import { useSubmitLock } from "@/lib/useSubmitLock";

const SEV = { low: "#6aa5ff", medium: "#e6b43c", high: "#f08a3c", critical: "#ef4b4b" };
const STATUS_TONE = { applied: C.green, proposed: "#e6b43c", reverted: C.muted, expired: C.muted, dismissed: C.muted };
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const TABS = [["alerts", "Alerts"], ["incidents", "Incidents"], ["contain", "Containment"], ["access", "Access"], ["platform", "Platform"], ["controls", "Controls"]];

function SevBadge({ s }) { return <span style={{ background: `${SEV[s]}26`, color: SEV[s], border: `1px solid ${SEV[s]}55`, borderRadius: 999, padding: "2px 9px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em" }}>{s}</span>; }

export default function SecurityOps() {
  const [d, setD] = useState(null), [err, setErr] = useState(""), [note, setNote] = useState(""), [tab, setTab] = useState("alerts");
  const { busy, run } = useSubmitLock();
  const load = useCallback(() => adminApi.get("soc").then((x) => { setD(x); setErr(""); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  const post = (verb, body, ok) => run(async () => { setErr(""); setNote(""); try { const r = await adminApi.post(`soc/${verb}`, body); if (ok) setNote(ok); await load(); return r; } catch (e) { setErr(e.message); } });

  if (err && !d) return <ErrorNote>{err}</ErrorNote>;
  if (!d) return <Loading />;
  const s = d.summary, st = d.settings, me = d.me;
  const modeLabel = { off: "Off", recommend: "Recommend only", auto: "Automatic" }[st.mode];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div><h1 style={{ ...displayFont, fontSize: 28, letterSpacing: "-0.02em", margin: 0 }}>Security Operations</h1>
          <div style={{ fontSize: 13.5, color: C.muted, marginTop: 3 }}>Alerts, incidents and containment. Containment mode: <b style={{ color: st.killSwitch ? SEV.critical : C.text }}>{st.killSwitch ? "KILL SWITCH ON (no automatic action)" : modeLabel}</b></div></div>
        {me.manage && <div style={{ display: "flex", gap: 8 }}>
          <button style={btn()} disabled={busy} onClick={() => post("drill", {}, "Drill alert created. Nothing was changed.")}>Run drill</button>
          <button style={btn(st.killSwitch ? "primary" : "danger")} disabled={busy} onClick={() => { if (st.killSwitch || window.confirm("Revert every automatic action now and stop further automatic containment?")) post("kill_switch", { on: !st.killSwitch }, st.killSwitch ? "Kill switch released." : "Kill switch on: automatic actions reverted."); }}>{st.killSwitch ? "Release kill switch" : "Safe mode (kill switch)"}</button>
        </div>}
      </div>
      {err && <ErrorNote>{err}</ErrorNote>}
      {note && <div style={{ color: C.green, fontSize: 13.5, margin: "4px 0 8px" }}>{note}</div>}
      {st.freezeRoleChangesUntil > new Date().toISOString() && <div style={{ ...card, borderColor: SEV.high, marginBottom: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>Role and permission changes are frozen until {when(st.freezeRoleChangesUntil)}.{me.manage && <button style={btn()} onClick={() => post("lift_freeze", {}, "Freeze lifted.")}>Lift freeze</button>}</div>}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", marginBottom: 12 }}>
        <Stat label="Open alerts" value={s.openAlerts} /><Stat label="Critical" value={s.critical} tone={s.critical ? "bad" : undefined} /><Stat label="High" value={s.high} />
        <Stat label="Open incidents" value={s.openIncidents} /><Stat label="Awaiting approval" value={s.proposed} /><Stat label="Active measures" value={s.activeActions} /><Stat label="Fix tasks" value={s.openTasks} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ ...btn(tab === k ? "primary" : undefined), borderRadius: 999 }}>{l}</button>)}
      </div>

      {tab === "alerts" && <Alerts d={d} me={me} post={post} busy={busy} />}
      {tab === "incidents" && <Incidents d={d} me={me} post={post} busy={busy} />}
      {tab === "contain" && <Contain d={d} me={me} post={post} busy={busy} />}
      {tab === "access" && <Access d={d} me={me} post={post} busy={busy} />}
      {tab === "platform" && <Platform d={d} me={me} post={post} busy={busy} reload={load} />}
      {tab === "controls" && <Controls d={d} />}
    </div>
  );
}

function Alerts({ d, me, post, busy }) {
  const [f, setF] = useState("open"), [open, setOpen] = useState(null);
  const list = d.alerts.filter((a) => (f === "all" ? true : f === "open" ? ["open", "ack"].includes(a.status) : a.severity === f));
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>{["open", "critical", "high", "medium", "low", "all"].map((x) => <button key={x} onClick={() => setF(x)} style={{ ...btn(f === x ? "primary" : undefined), padding: "4px 12px", minHeight: 30, fontSize: 13 }}>{x}</button>)}</div>
      {!list.length && <div style={{ ...card, color: C.muted }}>No alerts here. Detection covers sign-in abuse, impossible travel, new devices, scraping, mass downloads, MFA fatigue, privilege changes, honeytokens and WAF matches.</div>}
      {list.map((a) => {
        const acts = d.actions.filter((x) => x.alertId === a.id);
        return (
          <div key={a.id} style={{ ...card, marginBottom: 8, borderLeft: `4px solid ${SEV[a.severity]}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <SevBadge s={a.severity} /><b style={{ fontSize: 14.5 }}>{a.title}</b>{a.count > 1 && <Pill>×{a.count}</Pill>}<Pill>{a.status.replace("_", " ")}</Pill>
              <span style={{ ...monoFont, fontSize: 12, color: C.muted, marginLeft: "auto" }}>{when(a.createdAt)}{a.ip ? ` · ${a.ip}` : ""}</span>
            </div>
            <button onClick={() => setOpen(open === a.id ? null : a.id)} style={{ background: "none", border: "none", color: C.mustard, cursor: "pointer", padding: "6px 0", fontSize: 13 }}>{open === a.id ? "Hide details" : "Details & response"}</button>
            {open === a.id && (
              <div>
                <pre style={{ ...monoFont, fontSize: 12, background: C.surface2, borderRadius: 10, padding: 10, overflow: "auto", margin: "0 0 8px" }}>{JSON.stringify(a.detail, null, 2)}</pre>
                {acts.map((x) => <div key={x.id} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}><b style={{ color: STATUS_TONE[x.status] }}>{x.status}</b> {x.label}{x.target && x.target !== "system" ? ` · ${x.target}` : ""}<span style={{ color: C.muted }}>{x.mode}{x.expiresAt ? ` · until ${when(x.expiresAt)}` : ""}</span>
                  {me.respond && x.status === "proposed" && <button style={btn("primary")} disabled={busy} onClick={() => post("approve", { id: x.id }, "Applied.")}>Approve</button>}
                  {me.respond && ["proposed", "applied"].includes(x.status) && <button style={btn()} disabled={busy} onClick={() => post("revert", { id: x.id }, x.status === "proposed" ? "Dismissed." : "Reverted.")}>{x.status === "proposed" ? "Dismiss" : "Undo"}</button>}</div>)}
                {me.respond && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {a.status === "open" && <button style={btn()} disabled={busy} onClick={() => post("alert", { id: a.id, status: "ack" })}>Acknowledge</button>}
                  <button style={btn()} disabled={busy} onClick={() => post("alert", { id: a.id, status: "resolved" })}>Resolve</button>
                  <button style={btn()} disabled={busy} title="Also undoes any containment applied for this alert" onClick={() => post("alert", { id: a.id, status: "false_positive" }, "Marked false positive; its measures were undone.")}>False positive</button>
                </div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Incidents({ d, me, post, busy }) {
  const [open, setOpen] = useState(null), [note, setNote] = useState(""), [nw, setNw] = useState(null);
  return (
    <div>
      {me.manage && <div style={{ marginBottom: 10 }}>{nw ? <div style={{ ...card, display: "grid", gap: 8 }}>
        <input style={inputStyle} placeholder="Incident title" value={nw.title} onChange={(e) => setNw({ ...nw, title: e.target.value })} />
        <Select style={inputStyle} value={nw.severity} onChange={(e) => setNw({ ...nw, severity: e.target.value })}>{["low", "medium", "high", "critical"].map((x) => <option key={x} value={x}>{x}</option>)}</Select>
        <div style={{ display: "flex", gap: 8 }}><button style={btn("primary")} disabled={busy || !nw.title} onClick={async () => { await post("incident_create", nw, "Incident opened."); setNw(null); }}>Open incident</button><button style={btn()} onClick={() => setNw(null)}>Cancel</button></div>
      </div> : <button style={btn("primary")} onClick={() => setNw({ title: "", severity: "medium" })}>+ Declare incident</button>}</div>}
      {!d.incidents.length && <div style={{ ...card, color: C.muted }}>No incidents. High and critical alerts open one automatically.</div>}
      {d.incidents.map((i) => {
        const tasks = d.tasks.filter((t) => t.incident_id === i.id), acts = d.actions.filter((a) => a.incidentId === i.id), rec = i.recommendation;
        return (
          <div key={i.id} style={{ ...card, marginBottom: 8, borderLeft: `4px solid ${SEV[i.severity]}`, opacity: i.status === "resolved" ? 0.7 : 1 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}><SevBadge s={i.severity} /><b>{i.title}</b><Pill>{i.status}</Pill><span style={{ ...monoFont, fontSize: 12, color: C.muted, marginLeft: "auto" }}>{when(i.createdAt)}</span></div>
            <button onClick={() => setOpen(open === i.id ? null : i.id)} style={{ background: "none", border: "none", color: C.mustard, cursor: "pointer", padding: "6px 0", fontSize: 13 }}>{open === i.id ? "Close" : "Open incident"}</button>
            {open === i.id && <div style={{ display: "grid", gap: 12 }}>
              {me.respond && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["investigating", "contained", "resolved", "open"].filter((x) => x !== i.status).map((x) => <button key={x} style={btn()} disabled={busy} onClick={() => post("incident_status", { id: i.id, status: x })}>Mark {x}</button>)}
                <button style={btn("primary")} disabled={busy} onClick={() => post("recommend", { id: i.id }, "Recommendations ready.")}>{rec ? "Refresh" : "Get"} recommendations</button>
              </div>}
              {rec && <div style={{ background: C.surface2, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{rec.source === "ai" ? "AI recommendation" : "Built-in playbook"} · you decide what to run</div>
                <div style={{ fontSize: 13.5, marginBottom: 8 }}>{rec.summary}</div>
                <b style={{ fontSize: 13 }}>Quick measures</b><ul style={{ margin: "4px 0 8px 18px", fontSize: 13.5 }}>{rec.quick.map((q) => <li key={q}>{q}</li>)}</ul>
                <b style={{ fontSize: 13 }}>Permanent fixes</b>
                <ul style={{ margin: "4px 0 6px 18px", fontSize: 13.5 }}>{rec.fix.map((f) => <li key={f.title}>{f.title} <span style={{ color: C.muted }}>· owner: {f.owner}</span></li>)}</ul>
                {me.respond && !tasks.length && <button style={btn()} disabled={busy} onClick={() => post("tasks_from_rec", { id: i.id, items: rec.fix }, "Fix tasks created for the owners.")}>Turn fixes into tasks</button>}
              </div>}
              {!!tasks.length && <div><b style={{ fontSize: 13 }}>Fix tasks</b>{tasks.map((t) => <div key={t.id} style={{ fontSize: 13.5, display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}><span style={{ textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</span><Pill>{t.owner_role}</Pill>{t.status === "open" && me.respond && <button style={{ ...btn(), padding: "2px 10px", minHeight: 26 }} onClick={() => post("task_done", { id: t.id })}>Done</button>}</div>)}</div>}
              {!!acts.length && <div><b style={{ fontSize: 13 }}>Measures</b>{acts.map((a) => <div key={a.id} style={{ fontSize: 13, marginTop: 3 }}><b style={{ color: STATUS_TONE[a.status] }}>{a.status}</b> {a.label}{a.target && a.target !== "system" ? ` · ${a.target}` : ""} <span style={{ color: C.muted }}>({a.mode})</span></div>)}</div>}
              <div><b style={{ fontSize: 13 }}>Timeline</b>{[...i.timeline].reverse().map((t, k) => <div key={k} style={{ fontSize: 13, color: C.muted, marginTop: 3 }}><span style={monoFont}>{when(t.at)}</span> · {t.text}</div>)}</div>
              {me.respond && <div style={{ display: "flex", gap: 8 }}><input style={inputStyle} placeholder="Add a note to the timeline" value={note} onChange={(e) => setNote(e.target.value)} /><button style={btn()} disabled={busy || !note} onClick={async () => { await post("incident_note", { id: i.id, note }); setNote(""); }}>Add</button></div>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function Contain({ d, me, post, busy }) {
  const st = d.settings; const [mode, setMode] = useState(st.mode), [max, setMax] = useState(st.maxAutoPerHour);
  const [f, setF] = useState({ action: "block_ip", target: "", ttlMin: "", note: "" }), [al, setAl] = useState({ value: "", note: "" });
  const def = d.actionCatalog.find((x) => x.key === f.action);
  useEffect(() => { setMode(st.mode); setMax(st.maxAutoPerHour); }, [st.mode, st.maxAutoPerHour]);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <b>Automatic containment</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 10px" }}>Safe by design: automatic measures only touch one IP or one ordinary account, never staff or allow-listed IPs, always expire, and can be undone. If too many fire in an hour a circuit breaker drops back to recommend-only. The kill switch reverts them all.</div>
        {me.manage ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Select style={{ ...inputStyle, width: 220 }} value={mode} onChange={(e) => setMode(e.target.value)}><option value="off">Off</option><option value="recommend">Recommend only (approve each)</option><option value="auto">Automatic</option></Select>
          <label style={{ fontSize: 13 }}>Max automatic actions per hour <input style={{ ...inputStyle, width: 70 }} type="number" min="1" max="60" value={max} onChange={(e) => setMax(e.target.value)} /></label>
          <button style={btn("primary")} disabled={busy} onClick={() => { if (mode === "auto" && st.mode !== "auto" && !window.confirm("Turn on automatic containment? Measures will apply without approval (they still expire and can be undone).")) return; post("settings", { mode, maxAutoPerHour: max }, "Saved."); }}>Save</button>
        </div> : <div>Mode: {st.mode}</div>}
      </div>

      {me.respond && <div style={card}>
        <b>Run a measure now</b>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 8 }}>
          <Select style={inputStyle} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>{d.actionCatalog.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>
          {def?.target !== "system" && <input style={inputStyle} placeholder={def?.target === "ip" ? "IP address" : def?.target === "country" ? "Country code (KE)" : "Account ID"} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />}
          <input style={inputStyle} placeholder={`Minutes (default ${def?.ttlMin || "none"})`} value={f.ttlMin} onChange={(e) => setF({ ...f, ttlMin: e.target.value })} />
          <input style={inputStyle} placeholder="Reason" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
        <button style={{ ...btn("primary"), marginTop: 8 }} disabled={busy} onClick={async () => { await post("act", f, "Applied. You can undo it below."); setF({ ...f, target: "" }); }}>Apply</button>
      </div>}

      <div style={card}>
        <b>Active rules ({d.rules.length})</b>
        {!d.rules.length && <div style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>None. The proxy is not blocking anyone.</div>}
        {d.rules.map((r) => <div key={r.id} style={{ fontSize: 13.5, marginTop: 4 }}><b>{r.effect}</b> {r.kind} <span style={monoFont}>{r.value}</span> <span style={{ color: C.muted }}>{r.reason}{r.expiresAt ? ` · expires ${when(r.expiresAt)}` : ""}</span></div>)}
      </div>

      <div style={card}>
        <b>Action history</b>
        {d.actions.slice(0, 40).map((a) => <div key={a.id} style={{ fontSize: 13, marginTop: 5, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <b style={{ color: STATUS_TONE[a.status] }}>{a.status}</b> {a.label}{a.target && a.target !== "system" ? ` · ${a.target}` : ""} <span style={{ color: C.muted }}>{a.mode} · {when(a.createdAt)}</span>
          {me.respond && a.status === "proposed" && <button style={btn("primary")} disabled={busy} onClick={() => post("approve", { id: a.id }, "Applied.")}>Approve</button>}
          {me.respond && ["proposed", "applied"].includes(a.status) && <button style={btn()} disabled={busy} onClick={() => post("revert", { id: a.id })}>{a.status === "proposed" ? "Dismiss" : "Undo"}</button>}
        </div>)}
      </div>

      <div style={card}>
        <b>Allow-list (never auto-blocked)</b>
        {d.allow.map((a) => <div key={a.value} style={{ fontSize: 13.5, marginTop: 4 }}><span style={monoFont}>{a.value}</span> <span style={{ color: C.muted }}>{a.note}</span> {me.manage && <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={() => post("allow_remove", { value: a.value })}>Remove</button>}</div>)}
        {me.manage && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input style={{ ...inputStyle, width: 200 }} placeholder="IP address" value={al.value} onChange={(e) => setAl({ ...al, value: e.target.value })} /><input style={{ ...inputStyle, width: 220 }} placeholder="Note (office, monitoring…)" value={al.note} onChange={(e) => setAl({ ...al, note: e.target.value })} /><button style={btn()} disabled={busy || !al.value} onClick={async () => { await post("allow_add", al, "Added."); setAl({ value: "", note: "" }); }}>Add</button></div>}
      </div>
    </div>
  );
}

function Access({ d, me, post, busy }) {
  const [p, setP] = useState({ name: "", perms: "users.enforce.severe, staff.manage, roles.manage", hoursStart: "", hoursEnd: "", countries: "", ipPrefixes: "", appliesToSuperAdmin: false });
  const [j, setJ] = useState({ accountId: "", role: "admin", minutes: 60, reason: "" });
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <b>Attribute-based policies (ABAC)</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Listed permissions are only allowed when every condition holds. Super admins are exempt unless you tick the box, so a mistake here can&apos;t lock everyone out.</div>
        {d.policies.map((x) => <div key={x.id} style={{ fontSize: 13.5, marginTop: 4 }}><b>{x.name}</b> <span style={{ color: C.muted }}>{x.perms.join(", ")} · {Object.entries(x.conditions).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(" · ")}</span> {me.manage && <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={() => post("policy_delete", { id: x.id })}>Delete</button>}</div>)}
        {me.manage && <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 10 }}>
          <input style={inputStyle} placeholder="Policy name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          <input style={inputStyle} placeholder="Permissions (comma list, or prefix.*)" value={p.perms} onChange={(e) => setP({ ...p, perms: e.target.value })} />
          <input style={inputStyle} placeholder="Allowed from hour (UTC 0-23)" value={p.hoursStart} onChange={(e) => setP({ ...p, hoursStart: e.target.value })} />
          <input style={inputStyle} placeholder="…until hour (UTC)" value={p.hoursEnd} onChange={(e) => setP({ ...p, hoursEnd: e.target.value })} />
          <input style={inputStyle} placeholder="Allowed countries (KE, US)" value={p.countries} onChange={(e) => setP({ ...p, countries: e.target.value })} />
          <input style={inputStyle} placeholder="Allowed IP prefixes (41.90.)" value={p.ipPrefixes} onChange={(e) => setP({ ...p, ipPrefixes: e.target.value })} />
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={p.appliesToSuperAdmin} onChange={(e) => setP({ ...p, appliesToSuperAdmin: e.target.checked })} /> Applies to super admins</label>
          <button style={btn("primary")} disabled={busy || !p.name} onClick={() => post("policy_save", p, "Policy saved.")}>Add policy</button>
        </div>}
      </div>

      <div style={card}>
        <b>Just-in-time access</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Temporary elevation that expires and reverts on its own. Every grant needs a reason and raises an audited alert.</div>
        {d.jit.map((x) => <div key={x.id} style={{ fontSize: 13.5, marginTop: 4 }}><b>{x.who}</b> {x.from} → {x.to} <Pill>{x.status}</Pill> <span style={{ color: C.muted }}>{x.reason} · until {when(x.expiresAt)}</span> {me.manage && x.status === "active" && <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={() => post("jit_revoke", { id: x.id }, "Revoked.")}>Revoke now</button>}</div>)}
        {me.manage && <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", marginTop: 10 }}>
          <input style={inputStyle} placeholder="Account ID" value={j.accountId} onChange={(e) => setJ({ ...j, accountId: e.target.value })} />
          <input style={inputStyle} placeholder="Role key (admin…)" value={j.role} onChange={(e) => setJ({ ...j, role: e.target.value })} />
          <input style={inputStyle} type="number" placeholder="Minutes (5-480)" value={j.minutes} onChange={(e) => setJ({ ...j, minutes: e.target.value })} />
          <input style={inputStyle} placeholder="Reason" value={j.reason} onChange={(e) => setJ({ ...j, reason: e.target.value })} />
          <button style={btn("primary")} disabled={busy || !j.accountId || !j.reason} onClick={() => post("jit_grant", j, "Temporary access granted.")}>Grant</button>
        </div>}
      </div>

      <div style={card}>
        <b>Decoys in place (honeytokens)</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 6px" }}>No real person or service holds these. Any use raises a critical alert. Decoy endpoints: /api/v1/admin/export, /api/backup/db, /wp-login.php.</div>
        {d.honey.map((h) => <div key={h.token} style={{ fontSize: 13 }}><span style={monoFont}>{h.token}</span> <span style={{ color: C.muted }}>{h.note}</span></div>)}
      </div>
      <div style={card}>
        <b>Detection catalogue</b>
        {d.alertTypes.map((t) => <div key={t.key} style={{ fontSize: 13.5, marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><SevBadge s={t.severity} />{t.label}<span style={{ color: C.muted }}>auto: {t.auto.length ? t.auto.join(", ") : "none (human decision)"}</span></div>)}
        <div style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>WAF rules: {d.wafRules.map((r) => r.label).join(" · ")}</div>
      </div>
    </div>
  );
}

function Controls({ d }) {
  const tone = { live: C.green, setup: "#6aa5ff", partial: "#e6b43c", external: C.muted };
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...card, fontSize: 13.5, color: C.muted }}>Honest coverage of the control families. <b style={{ color: C.green }}>Live</b> works now. <b style={{ color: "#6aa5ff" }}>Setup</b> is fully built and switches on when you add the credential listed. <b style={{ color: "#e6b43c" }}>Partial</b> says what is missing. <b>External</b> needs infrastructure outside the app (a guide is included).</div>
      {d.controls.map(([group, items]) => (
        <div key={group} style={card}><b>{group}</b>
          {items.map(([name, status, text]) => <div key={name} style={{ marginTop: 8 }}><span style={{ color: tone[status], fontWeight: 800, fontSize: 12, textTransform: "uppercase", marginRight: 8 }}>{status}</span><b style={{ fontSize: 14 }}>{name}</b><div style={{ fontSize: 13, color: C.muted, marginLeft: 0 }}>{text}</div></div>)}
        </div>
      ))}
    </div>
  );
}

const startReg = async (post0, label) => {
  const { startRegistration } = await import("@simplewebauthn/browser");
  const o = await adminApi.post("webauthn/reg-options");
  const response = await startRegistration({ optionsJSON: o.options });
  await adminApi.post("webauthn/reg-verify", { response, token: o.token, label });
};

function Platform({ d, me, post, busy, reload }) {
  const p = d.platform, st = d.settings;
  const [v, setV] = useState({ name: "", value: "", note: "" }), [rv, setRv] = useState({ name: "", reason: "" }), [shown, setShown] = useState(null);
  const [ip, setIp] = useState(""), [rep, setRep] = useState(null), [txt, setTxt] = useState(""), [tr, setTr] = useState(null), [keyLabel, setKeyLabel] = useState(""), [msg, setMsg] = useState("");
  if (!me.manage || !p) return <div style={{ ...card, color: C.muted }}>Your role can&apos;t view platform security settings.</div>;
  const row = (ok, label, hint) => <div style={{ fontSize: 13.5, marginTop: 5 }}><b style={{ color: ok ? C.green : "#e6b43c" }}>{ok ? "ON" : "SETUP NEEDED"}</b> <b>{label}</b> <span style={{ color: C.muted }}>{hint}</span></div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <b>Integrations status</b>
        {row(p.dedicatedKey, "Vault master key", p.dedicatedKey ? "SECRETS_MASTER_KEY is set." : "Using a derived key. Set SECRETS_MASTER_KEY (openssl rand -base64 32).")}
        {row(p.siemOn, "SIEM forwarding", p.siemOn ? "Alerts and containment are sent to your webhook." : "Set SIEM_WEBHOOK_URL (and optional token/signing secret).")}
        {row(p.captcha, "CAPTCHA (Cloudflare Turnstile)", p.captcha ? "Shown adaptively on sign-in and sign-up." : "Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET.")}
        {row(p.rep.abuseipdb, "IP reputation feed (AbuseIPDB)", p.rep.abuseipdb ? "Active, plus internal history and Tor list." : "Optional. Set ABUSEIPDB_KEY. Internal history and the Tor list already work.")}
        {row(p.sso, "Staff SSO (OpenID Connect)", p.sso ? "Configured." : "Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ALLOWED_DOMAINS and NEXT_PUBLIC_SSO_ENABLED=true.")}
        {p.siemOn && <button style={{ ...btn(), marginTop: 8 }} disabled={busy} onClick={() => post("siem_test", {}, "Test event sent. Check your SIEM.")}>Send test event</button>}
      </div>

      <div style={card}>
        <b>Staff sign-in methods</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Staff can use any enrolled method: authenticator app, emailed code, security key or passkey, one-time recovery codes. Company SSO (OpenID Connect) signs staff in without a password when it is configured.</div>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={st.emailMfa} onChange={(e) => post("email_mfa", { on: e.target.checked }, e.target.checked ? "Email codes allowed for staff." : "Email codes turned off. Staff who only used email must use another method.")} /> Allow emailed codes as a staff second factor (weaker than an app or key; turn off for the strictest setup)</label>
      </div>

      <div style={card}>
        <b>Under-attack mode</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Tightens the per-IP request limit and rejects requests with no user agent. Turn on during a flood; it does not replace an upstream DDoS shield (see the guide).</div>
        <button style={btn(st.attackMode ? "danger" : "primary")} disabled={busy} onClick={() => post("attack_mode", { on: !st.attackMode }, st.attackMode ? "Under-attack mode off." : "Under-attack mode on.")}>{st.attackMode ? "Turn off under-attack mode" : "Turn on under-attack mode"}</button>
      </div>

      <div style={card}>
        <b>Security keys (FIDO2 / passkeys) for your account</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Phishing-resistant sign-in. A registered key satisfies the admin second factor.</div>
        {p.myKeys.map((k) => <div key={k.id} style={{ fontSize: 13.5, marginTop: 4 }}>{k.label} <span style={{ color: C.muted }}>added {when(k.createdAt)}{k.lastUsedAt ? ` · used ${when(k.lastUsedAt)}` : ""}</span> <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={async () => { await adminApi.post("webauthn/delete", { id: k.id }); setMsg("Key removed."); reload(); }}>Remove</button></div>)}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, width: 200 }} placeholder="Name (YubiKey, phone…)" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
          <button style={btn("primary")} disabled={busy} onClick={async () => { try { await startReg(post, keyLabel || "Security key"); setMsg("Security key added."); reload(); } catch (e) { setMsg(e.message); } }}>Add security key</button>
        </div>
        <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}><input type="checkbox" checked={st.webauthnOnly} onChange={(e) => post("webauthn_only", { on: e.target.checked }, e.target.checked ? "Staff with a key must now use it." : "Authenticator codes allowed again.")} /> Require the key for staff who have one registered (disables the code fallback for them)</label>
        {msg && <div style={{ fontSize: 13, color: C.green, marginTop: 6 }}>{msg}</div>}
      </div>

      <div style={card}>
        <b>Secrets vault</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Encrypted at rest (AES-256-GCM). Revealing a value needs a reason and is logged. The app reads SIEM_* values from here before environment variables.</div>
        {p.vault.map((x) => <div key={x.name} style={{ fontSize: 13.5, marginTop: 4 }}><span style={monoFont}>{x.name}</span> <span style={{ color: C.muted }}>{x.note || ""} {x.rotatedAt ? `· rotated ${when(x.rotatedAt)}` : `· added ${when(x.createdAt)}`}</span> <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={() => setRv({ name: x.name, reason: "" })}>Reveal</button> <button style={{ ...btn(), padding: "1px 9px", minHeight: 24 }} onClick={() => window.confirm(`Delete ${x.name}?`) && post("vault_delete", { name: x.name })}>Delete</button></div>)}
        {rv.name && <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input style={{ ...inputStyle, width: 320 }} placeholder={`Why do you need ${rv.name}?`} value={rv.reason} onChange={(e) => setRv({ ...rv, reason: e.target.value })} /><button style={btn("primary")} disabled={busy} onClick={async () => { const r = await post("vault_reveal", rv); if (r?.value) setShown({ name: rv.name, value: r.value }); setRv({ name: "", reason: "" }); }}>Reveal</button></div>}
        {shown && <div style={{ ...monoFont, fontSize: 12.5, background: C.surface2, borderRadius: 10, padding: 10, marginTop: 8, wordBreak: "break-all" }}>{shown.name}: {shown.value} <button style={{ ...btn(), marginLeft: 8, padding: "1px 9px", minHeight: 24 }} onClick={() => setShown(null)}>Hide</button></div>}
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 10 }}>
          <input style={inputStyle} placeholder="Name (e.g. SIEM_WEBHOOK_URL)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <input style={inputStyle} type="password" placeholder="Secret value" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} />
          <input style={inputStyle} placeholder="Note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          <button style={btn("primary")} disabled={busy || !v.name || !v.value} onClick={async () => { await post("vault_put", v, "Saved (or rotated)."); setV({ name: "", value: "", note: "" }); }}>Store / rotate</button>
        </div>
        {!!p.vaultLog.length && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>Recent reveals: {p.vaultLog.slice(0, 5).map((l) => `${l.name} (${when(l.created_at)}: ${l.reason})`).join(" · ")}</div>}
      </div>

      <div style={card}>
        <b>IP reputation lookup</b>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}><input style={{ ...inputStyle, width: 220 }} placeholder="IP address" value={ip} onChange={(e) => setIp(e.target.value)} /><button style={btn()} disabled={busy || !ip} onClick={async () => setRep(await post("rep_lookup", { ip }))}>Check</button></div>
        {rep && <div style={{ fontSize: 13.5, marginTop: 8 }}>Score <b>{rep.score}/100</b> <span style={{ color: C.muted }}>({rep.source})</span><ul style={{ margin: "4px 0 0 18px" }}>{rep.reasons.length ? rep.reasons.map((r) => <li key={r}>{r}</li>) : <li>Nothing known against this IP.</li>}</ul></div>}
      </div>

      <div style={card}>
        <b>Trace leaked content (DLP fingerprint)</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 8px" }}>Paste text or JSON that leaked from an export. Each download carries an invisible per-download id.</div>
        <textarea style={{ ...inputStyle, width: "100%", minHeight: 90 }} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Paste the leaked text here" />
        <button style={{ ...btn(), marginTop: 8 }} disabled={busy || !txt} onClick={async () => setTr((await post("trace", { text: txt }))?.matches || [])}>Trace</button>
        {tr && (tr.length ? tr.map((m) => <div key={m.fp} style={{ fontSize: 13.5, marginTop: 6 }}><b>{m.who || m.accountId}</b> downloaded <b>{m.kind}</b> on {when(m.at)} <span style={{ color: C.muted }}>({m.fp})</span></div>) : <div style={{ fontSize: 13.5, marginTop: 6, color: C.muted }}>No fingerprint found in that text.</div>)}
      </div>

      <div style={card}>
        <b>Staff devices (posture)</b>
        <div style={{ fontSize: 13, color: C.muted, margin: "4px 0 6px" }}>Reported by the native app. Staff on a non-compliant device are blocked from the admin API.</div>
        {!p.devices.length && <div style={{ color: C.muted, fontSize: 13 }}>No devices have reported yet.</div>}
        {p.devices.map((x, i) => <div key={i} style={{ fontSize: 13.5, marginTop: 4 }}><b style={{ color: x.compliant ? C.green : SEV.high }}>{x.compliant ? "OK" : "BLOCKED"}</b> {x.who} · {x.platform} {x.os} · app {x.app} <span style={{ color: C.muted }}>{x.reasons.join(", ")} · {when(x.seenAt)}</span></div>)}
      </div>
    </div>
  );
}
