import { NextResponse, after } from "next/server";
import { channelStatus, listBroadcasts, reach, renderPreview, createBroadcast, sendTest, cancelBroadcast, processDueBroadcasts } from "@/lib/admin/broadcast";
import { getStaff, requireStaff } from "@/lib/admin/guard";
import { SECTIONS, permissionsFor, sectionsFor, can, ENFORCEMENT_ACTIONS } from "@/lib/admin/roles";
import { overview, listUsers, userDetail, LIST, ACT, CREATE, DETAIL, setPlanForTesting, badges, globalSearch } from "@/lib/admin/service";
import { applyEnforcement, logStaff } from "@/lib/admin/enforce";
import { twoFactorState, beginSetup, confirmSetup, verifyLogin, sendEmailCode, confirmEmailEnrol, disableEmailMethod } from "@/lib/admin/twofactor";
import { throttle } from "@/lib/identity/throttle-http";

// One dispatcher for the whole admin API (web + native share it):
//   GET  me                         who am I, 2FA state, and (once 2FA-verified) allowed sections
//   POST 2fa/setup | 2fa/confirm | 2fa/verify
//   GET  overview | users[/:id] | <section> | <section>/:id (detail pages)
//   POST users/:id/enforce | users/:id/plan | <section>/create | <section>/:rowId/:action
// Every call below `me` and `2fa/*` requires a verified second factor.

const EXTRA_PERM = { "enforcements.revoke": "users.enforce.severe", "appeals.accepted": "appeals.handle", "appeals.rejected": "appeals.handle", "payments.set_plan": "payments.manage", "payments.cancel_sub": "payments.manage", "payments.refund": "payments.manage", "stories.purge": "users.enforce.severe", "advertisers.delete": "ads.review", "support.delete": "users.enforce.severe", "planlimits.set": "payments.manage", "planlimits.reset": "payments.manage", "companies.terminate": "users.enforce.severe" };
// Expected failures (validation, permission) carry a status and a safe message; anything else
// is logged server-side and the caller only sees a generic line — never SQL, paths or stack traces.
const fail = (e) => {
  if (e?.status && e.status < 500) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("Admin API error:", e);
  return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
};
const DONE = new Set(["approved", "rejected", "accepted", "actioned", "dismissed", "resolved", "complied", "contested", "takedown", "revoked"]);

function withToken(res, token) {
  res.cookies.set("lo_2fa", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  return res;
}

export async function GET(request, { params }) {
  const [a, b] = (await params).path;
  if (a === "me") {
    const staff = await getStaff();
    if (!staff) return NextResponse.json({ staff: false });
    const tf = await twoFactorState(staff.id);
    const base = { staff: true, role: staff.role, pseudonym: staff.pseudonym, twoFactor: tf };
    if (!tf.verified) return NextResponse.json(base);
    return NextResponse.json({ ...base, permissions: permissionsFor(staff.role), sections: sectionsFor(staff.role), enforcementActions: ENFORCEMENT_ACTIONS });
  }
  // NOTE: global search lives at "gsearch" — "search" is the Search Admin section (it used to be hijacked here).
  if (a === "badges" || a === "gsearch") {
    const { staff, error } = await requireStaff();
    if (error) return error;
    try { return NextResponse.json(a === "badges" ? await badges() : { hits: await globalSearch(staff, new URL(request.url).searchParams.get("q")) }); } catch (e) { return fail(e); }
  }
  if (a === "live") {
    const { error } = await requireStaff();
    if (error) return error;
    try { const { liveSnapshot } = await import("@/lib/admin/presence"); return NextResponse.json(await liveSnapshot(), { headers: { "Cache-Control": "no-store" } }); } catch (e) { return fail(e); }
  }
  const sec = SECTIONS.find((s) => s.id === a);
  if (!sec) return NextResponse.json({ error: "Unknown section." }, { status: 404 });
  const { staff, error } = await requireStaff(sec.perm);
  if (error) return error;
  try {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);
    if (a === "push" || a === "emailcast") { const ch = a === "push" ? "push" : "email"; return NextResponse.json({ channel: ch, status: await channelStatus(ch), history: await listBroadcasts(ch) }); }
    if (a === "overview") return NextResponse.json(await overview());
    if (a === "users") {
      if (b) return NextResponse.json(await userDetail(staff, b));
      return NextResponse.json({ users: await listUsers(staff, { q: url.searchParams.get("q") || "", status: url.searchParams.get("status") || "" }), canPII: can(staff.role, "users.pii") });
    }
    if (a === "soc") {
      const sec = await import("@/lib/security/core");
      const { ALERT_TYPES } = sec;
      const { CONTROLS } = await import("@/lib/security/controls");
      const { can: canDo } = await import("@/lib/admin/roles");
      const { WAF_RULES } = await import("@/lib/security/waf");
      const bundle = await sec.socBundle(canDo(staff.role, "users.pii"));
      const plat = canDo(staff.role, "security.manage") ? await (async () => {
        const vault = await import("@/lib/security/vault"), posture = await import("@/lib/security/posture"), siem = await import("@/lib/security/siem"), rep = await import("@/lib/security/reputation"), cap = await import("@/lib/security/botdefense"), sso = await import("@/lib/security/sso"), wa = await import("@/lib/security/webauthn");
        return { vault: await vault.vaultList(), vaultLog: await vault.vaultAccessLog(), dedicatedKey: vault.vaultUsesDedicatedKey(), devices: await posture.listPosture(), siemOn: await siem.siemConfigured(), rep: rep.reputationSources(), captcha: cap.captchaConfigured(), sso: sso.ssoConfigured(), myKeys: await wa.listKeys(staff.id) };
      })().catch(() => null) : null;
      return NextResponse.json({ ...bundle, platform: plat, controls: CONTROLS, alertTypes: Object.entries(ALERT_TYPES).map(([k, v]) => ({ key: k, label: v.label, severity: v.sev, auto: v.auto.map((x) => x.action) })), wafRules: WAF_RULES, me: { role: staff.role, respond: canDo(staff.role, "incidents.respond"), manage: canDo(staff.role, "security.manage"), pii: canDo(staff.role, "users.pii") } });
    }
    if (a === "roles") {
      const rbac = await import("@/lib/admin/rbac");
      return NextResponse.json({ roles: await rbac.listRoles(), catalog: await rbac.permissionCatalog(), plans: ["", "basic", "plus", "pro"], sections: SECTIONS.map((x) => ({ id: x.id, label: x.label, perm: x.perm })), isSuper: staff.role === "super_admin", me: staff.role });
    }
    const actionsFor = (data) => (data.actions || []).filter((x) => !(EXTRA_PERM[`${a}.${x.id}`] && !can(staff.role, EXTRA_PERM[`${a}.${x.id}`])) && !(a === "staff" && staff.role !== "super_admin"));
    if (b && DETAIL[a]) {
      const d = await DETAIL[a](staff, b, query);
      d.section = a;
      if (d.noActions) { d.actions = []; return NextResponse.json(d); }
      const list = await LIST[a](staff);
      d.actions = actionsFor(list).filter((x) => !(list.pendingOnly?.includes(x.id) && !d.open));
      if (a === "support") d.actions = [
        { id: "reply", label: "Reply to user", input: { key: "body", label: "Your reply (the user is notified)" } },
        { id: "note", label: "Internal note", input: { key: "body", label: "Private note — never shown to the user" } },
        { id: "take", label: "Take" },
        { id: "priority", label: "Priority", input: { key: "value", label: "Priority", options: ["low", "normal", "high", "urgent"] } },
        { id: "status", label: "Status", input: { key: "value", label: "Status", options: ["open", "pending", "resolved", "closed"] } },
      ];
      return NextResponse.json(d);
    }
    const data = await LIST[a](staff, query);
    if (data.actions) data.actions = actionsFor(data);
    return NextResponse.json(data);
  } catch (e) { return fail(e); }
}

export async function POST(request, { params }) {
  const [a, b, c] = (await params).path;
  const body = await request.json().catch(() => ({}));

  // ---- Two-factor: reachable by staff before they've passed it ----
  if (a === "2fa") {
    const staff = await getStaff();
    if (!staff) return NextResponse.json({ error: "Staff access required." }, { status: 403 });
    try {
      const tfs = await twoFactorState(staff.id);
      // Adding a method is only allowed before any method exists, or after proving an existing one (otherwise a stolen
      // password could attach the attacker's own authenticator).
      const mayEnrol = !tfs.enabled || tfs.verified;
      if (b === "setup") {
        if (!mayEnrol) return NextResponse.json({ error: "Verify with your current method first." }, { status: 403 });
        if (tfs.methods.totp) return NextResponse.json({ error: "An authenticator is already set up. Ask a super admin to reset it." }, { status: 400 });
        return NextResponse.json(await beginSetup(staff, { fresh: !!body.fresh }));
      }
      if (b === "email-send") return NextResponse.json(await sendEmailCode(staff));
      if (b === "email-confirm") {
        if (!mayEnrol) return NextResponse.json({ error: "Verify with your current method first." }, { status: 403 });
        const r = await confirmEmailEnrol(staff, body.code); await logStaff(staff, "2fa_email_enabled");
        return withToken(NextResponse.json({ ok: true, recoveryCodes: r.recoveryCodes, token: r.token }), r.token);
      }
      if (b === "email-disable") { if (!tfs.verified) return NextResponse.json({ error: "Verify first." }, { status: 403 }); return NextResponse.json(await disableEmailMethod(staff)); }
      if (b === "confirm") { if (!mayEnrol) return NextResponse.json({ error: "Verify with your current method first." }, { status: 403 }); const r = await confirmSetup(staff, body.code); await logStaff(staff, "2fa_enabled"); return withToken(NextResponse.json({ ok: true, recoveryCodes: r.recoveryCodes, token: r.token }), r.token); }
      if (b === "webauthn-options") { const wa = await import("@/lib/security/webauthn"); return NextResponse.json(await wa.authenticationOptions(staff)); }
      if (b === "webauthn-verify") {
        const wa = await import("@/lib/security/webauthn"); await wa.verifyAuthentication(staff, body);
        const { issue2faToken } = await import("@/lib/admin/twofactor"); const token = issue2faToken(staff.id); await logStaff(staff, "2fa_login", "security_key");
        return withToken(NextResponse.json({ ok: true, token }), token);
      }
      if (b === "verify") {
        const sec0 = await import("@/lib/security/core"), wa0 = await import("@/lib/security/webauthn");
        if ((await sec0.getSettings()).webauthnOnly && await wa0.hasKeys(staff.id)) return NextResponse.json({ error: "Your organisation requires a security key for staff sign-in.", code: "KEY_REQUIRED" }, { status: 403 });
        const limited = await throttle(request, [["email", staff.id, "admin_2fa", { max: 8, windowMs: 15 * 60 * 1000, label: "2FA attempts" }]]);
        if (limited) return limited;
        const token = await verifyLogin(staff, body.code, body.method === "email" ? "email" : "auto"); await logStaff(staff, "2fa_login", body.method === "email" ? "email" : "code");
        return withToken(NextResponse.json({ ok: true, token }), token);
      }
    } catch (e) { return fail(e); }
    return NextResponse.json({ error: "Unknown 2FA step." }, { status: 404 });
  }

  if (a === "webauthn") { // manage your own security keys (needs a verified second factor, no special role)
    const { staff, error } = await requireStaff();
    if (error) return error;
    try {
      const wa = await import("@/lib/security/webauthn"); let out;
      if (b === "list") out = { keys: await wa.listKeys(staff.id) };
      else if (b === "reg-options") out = await wa.registrationOptions(staff);
      else if (b === "reg-verify") out = await wa.verifyRegistration(staff, body);
      else if (b === "delete") out = await wa.removeKey(staff.id, String(body.id || ""));
      else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
      return NextResponse.json(out);
    } catch (e) { return fail(e); }
  }

  const sec = SECTIONS.find((s) => s.id === a);
  if (!sec) return NextResponse.json({ error: "Unknown section." }, { status: 404 });
  const { staff, error } = await requireStaff(sec.perm);
  if (error) return error;
  try {
    if (a === "push" || a === "emailcast") {
      const ch = a === "push" ? "push" : "email";
      if (b === "preview") return NextResponse.json(await reach(ch, body.audience, body.kind));
      if (b === "render") return NextResponse.json({ html: renderPreview(body) });
      if (b === "test") return NextResponse.json({ ok: true, ...(await sendTest(staff, ch, body, body.to)) });
      if (b === "send") { const r = await createBroadcast(staff, ch, body); if (r.immediate) after(() => processDueBroadcasts()); return NextResponse.json({ ok: true, ...r }); }
      if (c === "cancel") { await cancelBroadcast(staff, b); return NextResponse.json({ ok: true }); }
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    if (a === "soc") {
      const sec = await import("@/lib/security/core");
      const { can: canDo } = await import("@/lib/admin/roles");
      const RESPOND = new Set(["alert", "act", "revert", "approve", "recommend", "task_done", "incident_note", "incident_status", "tasks_from_rec"]);
      const MANAGE = new Set(["email_mfa", "vault_put", "vault_reveal", "vault_delete", "rep_lookup", "trace", "siem_test", "attack_mode", "webauthn_only", "settings", "kill_switch", "incident_create", "policy_save", "policy_delete", "allow_add", "allow_remove", "jit_grant", "jit_revoke", "lift_freeze", "drill"]);
      if (RESPOND.has(b) && !canDo(staff.role, "incidents.respond")) return NextResponse.json({ error: "Your role can't run incident response actions." }, { status: 403 });
      if (MANAGE.has(b) && !canDo(staff.role, "security.manage")) return NextResponse.json({ error: "Your role can't change security settings." }, { status: 403 });
      const { requestInfo } = sec; const info = await requestInfo(); let out;
      if (b === "alert") out = await sec.alertStatus(staff, body.id, body.status);
      else if (b === "act") out = await sec.applyAction({ action: body.action, target: body.target, mode: "manual", actor: staff.id, alertId: body.alertId || null, incidentId: body.incidentId || null, ttlMin: body.ttlMin ? +body.ttlMin : null, note: body.note || "", actingIp: info.ip });
      else if (b === "approve") { const { identityDb } = await import("@/lib/identity/db"); const r = await identityDb.prepare("SELECT * FROM sec_actions WHERE id = ? AND status = 'proposed'").get(body.id); if (!r) return NextResponse.json({ error: "That proposal is no longer pending." }, { status: 404 }); out = await sec.applyAction({ action: r.action, target: r.target, mode: "manual", actor: staff.id, alertId: r.alert_id, incidentId: r.incident_id, ttlMin: JSON.parse(r.params || "{}").ttlMin, proposedId: r.id, actingIp: info.ip }); }
      else if (b === "revert") out = await sec.revertAction(body.id, staff.id);
      else if (b === "recommend") out = await sec.recommendFor(body.id, staff.pseudonym);
      else if (b === "tasks_from_rec") { await sec.createTasksFromRec(body.id, Array.isArray(body.items) ? body.items.slice(0, 8) : []); out = { ok: true }; }
      else if (b === "task_done") out = await sec.taskDone(staff, body.id);
      else if (b === "incident_note" || b === "incident_status") out = await sec.incidentUpdate(staff, body.id, { note: body.note, status: body.status, summary: body.summary });
      else if (b === "incident_create") out = await sec.incidentCreate(staff, body);
      else if (b === "settings") out = await sec.setMode(staff, body.mode, body.maxAutoPerHour);
      else if (b === "kill_switch") out = await sec.killSwitch(staff.id, !!body.on);
      else if (b === "lift_freeze") out = await sec.liftFreeze();
      else if (b === "policy_save") out = await sec.savePolicy(staff, body);
      else if (b === "policy_delete") out = await sec.deletePolicy(body.id);
      else if (b === "allow_add") out = await sec.allowAdd(staff, body.value, body.note);
      else if (b === "allow_remove") out = await sec.allowRemove(body.value);
      else if (b === "jit_grant") out = await sec.jitGrant(staff, body);
      else if (b === "jit_revoke") out = await sec.jitRevoke(body.id);
      else if (b === "drill") out = await sec.runDrill(staff);
      else if (b === "vault_put") out = await (await import("@/lib/security/vault")).vaultPut(staff, body);
      else if (b === "vault_reveal") out = await (await import("@/lib/security/vault")).vaultReveal(staff, String(body.name || ""), body.reason);
      else if (b === "vault_delete") out = await (await import("@/lib/security/vault")).vaultDelete(String(body.name || ""));
      else if (b === "rep_lookup") out = await (await import("@/lib/security/reputation")).ipReputation(String(body.ip || ""), { fresh: true });
      else if (b === "trace") out = { matches: await (await import("@/lib/security/dlp")).trace(String(body.text || "")) };
      else if (b === "siem_test") out = await (await import("@/lib/security/siem")).forwardEvent("test", { note: "Test event from Security Operations", by: staff.pseudonym });
      else if (b === "attack_mode") out = await sec.setFlag("attackMode", !!body.on);
      else if (b === "webauthn_only") out = await sec.setFlag("webauthnOnly", !!body.on);
      else if (b === "email_mfa") out = await sec.setFlag("emailMfa", !!body.on);
      else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
      const { logStaff } = await import("@/lib/admin/enforce"); await logStaff(staff, `soc.${b}`, body.id || body.target || body.value || null, JSON.stringify({ ...body, note: undefined }).slice(0, 300)).catch(() => {});
      return NextResponse.json(out);
    }
    if (a === "roles") {
      const rbac = await import("@/lib/admin/rbac");
      let out;
      if (b === "save") out = await rbac.saveRole(staff, body);
      else if (b === "delete") out = await rbac.deleteRole(staff, String(body.key || ""));
      else if (b === "permission") out = await rbac.addPermission(staff, body);
      else if (b === "permission-delete") out = await rbac.deletePermission(staff, String(body.key || ""));
      else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
      return NextResponse.json(out);
    }
    if (a === "users" && c === "enforce") {
      if (!can(staff.role, "users.enforce")) return NextResponse.json({ error: "Your role can't enforce." }, { status: 403 });
      const r = await applyEnforcement(staff, b, body.action, { reason: body.reason || "", days: body.days, privilege: body.privilege });
      return NextResponse.json({ ok: true, ...r });
    }
    if (a === "users" && c === "plan") { const out = await setPlanForTesting(staff, b, body.tier); return NextResponse.json({ ok: true, ...(out || {}) }); }
    if (b === "create") {
      if (!CREATE[a]) return NextResponse.json({ error: "Not supported." }, { status: 400 });
      if (a === "staff" && staff.role !== "super_admin") return NextResponse.json({ error: "Only a super admin manages staff." }, { status: 403 });
      await CREATE[a](staff, body); await logStaff(staff, `create:${a}`, null, JSON.stringify(Object.keys(body)));
      return NextResponse.json({ ok: true });
    }
    const need = EXTRA_PERM[`${a}.${c}`];
    if (need && !can(staff.role, need)) return NextResponse.json({ error: "Your role doesn't permit this action." }, { status: 403 });
    if (a === "staff" && staff.role !== "super_admin") return NextResponse.json({ error: "Only a super admin manages staff." }, { status: 403 });
    if (!ACT[a]) return NextResponse.json({ error: "Not supported." }, { status: 400 });
    const out = await ACT[a](staff, b, c, body);
    if (c !== "document") await logStaff(staff, `${a}:${c}`, b, body.reason || body.note || body.role || null);
    return NextResponse.json({ ok: true, ...(out || {}) });
  } catch (e) { return fail(e); }
}
