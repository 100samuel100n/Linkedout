// Admin sections for distribution and integrity, in the same LIST / ACT / CREATE shape as lib/admin/systems.js, so the web
// dashboard and the native admin app render them with no new UI code. Merged into the section engine by lib/admin/service.js.
import { identityDb } from "@/lib/identity/db";
import { can } from "@/lib/admin/roles";
import { logStaff } from "@/lib/admin/enforce";
import { distReady, settings, putSetting, bumpManifest, officialCerts, officialDomains, uid, now, J, P, bad, list, DEFAULTS } from "./db.js";
import { publicKeyInfo } from "./sign.js";
import { revokeInstall, restoreInstall, revokeByVersion, revokeAndBlock, revokeWhere, deleteRelease } from "./installs.js";
import { killInstall, restoreKilled } from "./kill.js";
import { ipOf, geoOf, preciseOf, placeText, mapsLink } from "./details.js";
import { normHex, colonHex } from "./canon.js";

const col = (key, label) => ({ key, label });
const tbl = (columns, rows, extra = {}) => ({ columns, rows, actions: [], summary: [], ...extra });
const ts = (v) => (v ? String(v).slice(0, 16).replace("T", " ") : "");
const cut = (s, k = 90) => (s && s.length > k ? s.slice(0, k) + "…" : s || "");
const REASON = { key: "reason", label: "Reason (kept in the audit log)" };
const need = (b, k, msg) => { if (!String(b[k] ?? "").trim()) throw bad(msg || `${k} is required.`); return String(b[k]).trim(); };
const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
const killWhere = async (staff, where, params, reason) => {
  const rows = await identityDb.prepare(`SELECT install_id FROM dist_installs WHERE status <> 'killed' AND (${where}) LIMIT 5000`).all(...params);
  let n = 0; for (const r of rows) { try { await killInstall(staff, r.install_id, reason); n++; } catch { /* already killed */ } } return n;
};
const num = async (sql, ...p) => +(await identityDb.prepare(sql).get(...p))?.n || 0;
const since = (d) => new Date(Date.now() - d * 864e5).toISOString();

export const LIST = {
  // ------------------------------------------------------------------ overview + counters
  async distribution() {
    await distReady(); const s = await settings(); const key = publicKeyInfo();
    const d = days(14);
    const ev = async (kind) => new Map((await identityDb.prepare("SELECT substr(created_at,1,10) d, COUNT(*) c FROM dist_events WHERE kind = ? AND created_at >= ? GROUP BY d").all(kind, since(14))).map((r) => [r.d, +r.c]));
    const [dl, reg, upd, pwa, pwaOpen, fail] = await Promise.all(["download", "install_register", "update_installed", "pwa_install", "pwa_open", "attest_fail"].map(ev));
    const active = await Promise.all(d.map(async (day) => [day, await num("SELECT COUNT(*) n FROM dist_installs WHERE substr(last_seen,1,10) = ?", day)]));
    const am = new Map(active);
    const rows = d.map((day) => ({ id: day, day, downloads: dl.get(day) || 0, installs: reg.get(day) || 0, updates: upd.get(day) || 0, activeDevices: am.get(day) || 0, pwaInstalls: pwa.get(day) || 0, pwaOpens: pwaOpen.get(day) || 0, failedChecks: fail.get(day) || 0 }));
    const byVer = await identityDb.prepare("SELECT COALESCE(version_name,'unknown') v, version_code c, COUNT(*) n FROM dist_installs WHERE status = 'active' AND last_seen > ? GROUP BY v, c ORDER BY c DESC LIMIT 6").all(since(30));
    return tbl([col("day", "Day"), col("downloads", "Downloads"), col("installs", "New installs"), col("updates", "Updates installed"), col("activeDevices", "Active devices"), col("pwaInstalls", "PWA installs"), col("pwaOpens", "PWA opens"), col("failedChecks", "Failed checks")], rows, {
      summary: [
        ["Downloads (all time)", (await num("SELECT COUNT(*) n FROM dist_events WHERE kind = 'download'")).toLocaleString()],
        ["Installs (registered)", (await num("SELECT COUNT(*) n FROM dist_installs")).toLocaleString()],
        ["Active devices (7 days)", (await num("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active' AND last_seen > ?", since(7))).toLocaleString()],
        ["PWA installs (all time)", (await num("SELECT COUNT(DISTINCT device_hash) n FROM dist_events WHERE kind = 'pwa_install'")).toLocaleString()],
        ["Active versions (30 days)", byVer.map((x) => `${x.v}: ${x.n}`).join(" · ") || "—"],
        ["Verification mode", s.mode === "enforce" ? "ENFORCE: unverified apps are refused" : s.mode === "monitor" ? "monitor only (flags, does not block)" : "off"],
        ["Manifest signing key", key ? `${key.fingerprint}` : "NOT CONFIGURED. Run scripts/dist-keygen.mjs"],
        ["Official signing certificates", String((await officialCerts()).length)],
        ["APK downloads", s.apk_enabled === "1" ? "ON" : "OFF: web app only"],
        ["Web notification subscriptions", (await num("SELECT COUNT(*) n FROM push_tokens WHERE platform = 'web'")).toLocaleString()],
        ["Web-app devices (active 7 days)", (await num("SELECT COUNT(*) n FROM dist_pwa WHERE last_seen > ?", since(7))).toLocaleString() + " of " + (await num("SELECT COUNT(*) n FROM dist_pwa")).toLocaleString() + " total"],
      ],
    });
  },

  // ------------------------------------------------------------------ releases
  async distreleases() {
    await distReady();
    const rows = (await identityDb.prepare("SELECT r.*, (SELECT COUNT(*) FROM dist_installs i WHERE i.version_code = r.version_code AND i.status = 'active') AS live FROM dist_releases r ORDER BY r.version_code DESC").all())
      .map((r) => ({ id: r.id, version: r.version_name, code: r.version_code, status: r.status, rollout: `${r.rollout_pct}%`, mandatory: r.mandatory ? "yes" : "", activeInstalls: +r.live, size: r.size_bytes ? (r.size_bytes / 1048576).toFixed(1) + " MB" : "", sha256: String(r.sha256).slice(0, 12) + "…", published: ts(r.published_at), notes: cut(r.notes, 80) }));
    const f = [
      { key: "version_name", label: "Version name (e.g. 1.2.0)" }, { key: "version_code", label: "Version code (integer, must increase)" },
      { key: "url", label: "APK download URL (https://…)" }, { key: "sha256", label: "APK SHA-256 (64 hex)" }, { key: "size_bytes", label: "APK size in bytes", optional: true },
      { key: "cert_sha256", label: "Signing certificate SHA-256 (64 hex)", optional: true }, { key: "mirror_urls", label: "Mirror APK URLs (one per line)", long: true, optional: true },
      { key: "notes", label: "What's new (shown in the updater)", long: true, optional: true }, { key: "min_supported", label: "Oldest version code still allowed (0 = no change)", optional: true },
      { key: "rollout_pct", label: "Rollout % (1–100, default 100)", optional: true },
    ];
    return tbl([col("version", "Version"), col("code", "Code"), col("status", "Status"), col("rollout", "Rollout"), col("mandatory", "Mandatory"), col("activeInstalls", "Active installs"), col("size", "Size"), col("sha256", "SHA-256"), col("published", "Published"), col("notes", "Notes")], rows, {
      chips: "status", detail: true, create: f, createLabel: "+ Register release", summary: [["Live releases", rows.filter((r) => r.status === "live").length], ["Drafts", rows.filter((r) => r.status === "draft").length]],
      actions: [
        { id: "publish", label: "Publish", when: { status: ["draft", "paused"] } },
        { id: "pause", label: "Pause", when: { status: ["live"] } },
        { id: "rollout", label: "Set rollout %", input: { key: "value", label: "Percent of installs that see this update (1–100)" }, when: { status: ["live", "draft", "paused"] } },
        { id: "mandatory_on", label: "Make mandatory", when: { mandatory: [""] }, confirm: "Everyone on an older version will be asked to update before continuing." },
        { id: "mandatory_off", label: "Not mandatory", when: { mandatory: ["yes"] } },
        { id: "delete_release", label: "Delete permanently", danger: true, input: { key: "confirm", label: "Type the version name to confirm. This revokes its installs and removes it for good." } },
        { id: "withdraw", label: "Withdraw (compromised/bad build)", danger: true, input: { key: "reason", label: "Why is this version being withdrawn?" }, when: { status: ["live", "paused", "draft"] } },
      ],
    });
  },

  // ------------------------------------------------------------------ channels & mirrors
  async distchannels() {
    await distReady();
    const rows = (await identityDb.prepare("SELECT * FROM dist_channels ORDER BY sort, label").all()).map((c) => ({ id: c.id, label: c.label, kind: c.kind, url: cut(c.url, 70), state: c.enabled ? "listed" : "hidden", official: c.official ? "official" : "unofficial", cert: c.cert_sha256 ? c.cert_sha256.slice(0, 12) + "…" : "", notes: cut(c.notes, 60), _form: { label: c.label, kind: c.kind, url: c.url, cert_sha256: c.cert_sha256 || "", fingerprint: c.fingerprint || "", notes: c.notes || "" } }));
    const f = [
      { key: "label", label: "Name (e.g. Samsung Galaxy Store)" },
      { key: "kind", label: "Type", options: [["website", "Our website"], ["apk", "Direct APK download"], ["pwa", "Web app (PWA)"], ["fdroid", "Own F-Droid repository"], ["obtainium", "Obtainium"], ["zapstore", "Zapstore"], ["samsung", "Samsung Galaxy Store"], ["huawei", "Huawei AppGallery"], ["aptoide", "Aptoide"], ["apkpure", "APKPure"], ["mirror", "Other mirror"]] },
      { key: "url", label: "URL (https://…)" }, { key: "cert_sha256", label: "Signing cert SHA-256 on this channel, if it differs (e.g. store re-signs)", optional: true },
      { key: "fingerprint", label: "Repository fingerprint (F-Droid / Zapstore npub)", optional: true }, { key: "notes", label: "Notes", long: true, optional: true },
    ];
    return tbl([col("label", "Channel"), col("kind", "Type"), col("url", "URL"), col("state", "State"), col("official", "Official?"), col("cert", "Cert override"), col("notes", "Notes")], rows, {
      chips: "kind", create: f, createLabel: "+ Add channel", actions: [
        { id: "edit", label: "Edit", form: f },
        { id: "hide", label: "Hide from manifest", when: { state: ["listed"] } }, { id: "show", label: "List in manifest", when: { state: ["hidden"] } },
        { id: "delete", label: "Delete", danger: true },
      ],
    });
  },

  // ------------------------------------------------------------------ installs
  async distinstalls(staff, q = {}) {
    await distReady();
    const inst = await identityDb.prepare("SELECT * FROM dist_installs ORDER BY last_seen DESC LIMIT 400").all();
    const ids = [...new Set(inst.map((i) => i.account_id).filter(Boolean))];
    const who = new Map((ids.length ? await identityDb.prepare("SELECT id, pseudonym, email, real_name FROM accounts WHERE id = ANY(?)").all(ids) : []).map((x) => [x.id, x]));
    if (inst.some((i) => i.ip_enc || i.precise)) await logStaff(staff, "view_install_personal_data", null, `${inst.length} installs (name, email, IP, location)`);
    const rows = inst.map((i) => {
      const a = P(i.attest, {}), d = P(i.device, {}), f = P(i.flags, {}), hw = P(i.hw, {}), geo = geoOf(i.geo), pr = preciseOf(i.precise), w = who.get(i.account_id);
      const tamper = Object.entries(f.integrity || {}).filter(([, v]) => v).map(([k]) => k);
      return { id: i.install_id, install: i.install_id.slice(0, 8), status: i.status, version: i.version_name || String(i.version_code || ""), channel: i.channel || "", trust: i.trust,
        name: w?.real_name || "", email: w?.email || "", handle: w?.pseudonym || (i.account_id ? "(account)" : ""),
        ip: ipOf(i.ip_enc), place: placeText(geo, pr), exact: pr ? mapsLink(pr.lat, pr.lon) : "", isp: geo.isp || "",
        device: `${d.model || "?"}${d.sdk ? " · Android SDK " + d.sdk : ""}${hw.brand ? " · " + hw.brand : ""}${hw.locale ? " · " + hw.locale : ""}${hw.tz ? " · " + hw.tz : ""}`,
        boot: a.boot || "", signals: tamper.join(", "), country: i.country || "", account: i.account_id ? "linked" : "", lastSeen: ts(i.last_seen), firstSeen: ts(i.first_seen), why: i.kill_reason || i.revoke_reason || "" };
    });
    return tbl([col("install", "Install"), col("status", "Status"), col("name", "Name"), col("email", "Email"), col("handle", "Handle"), col("ip", "IP address"), col("place", "Location"), col("exact", "Exact position (consented)"), col("isp", "Network"), col("version", "Version"), col("channel", "Channel"), col("trust", "Trust"), col("device", "Device"), col("boot", "Boot state"), col("signals", "Tamper signals"), col("country", "Country"), col("account", "Account"), col("lastSeen", "Last seen"), col("firstSeen", "First seen"), col("why", "Revoked / killed because")], rows, {
      chips: "status", detail: true, summary: [["Active", rows.filter((r) => r.status === "active").length], ["Killed", rows.filter((r) => r.status === "killed").length], ["Soft-revoked", rows.filter((r) => r.status === "revoked").length], ["Hardware-attested", rows.filter((r) => r.trust === "hardware").length]],
      actions: [
        { id: "revoke", label: "KILL install (lock, wipe, block device)", danger: true, input: { key: "reason", label: "Reason. The app locks and wipes itself within seconds, this phone can never register again, and it stays dead until you press Restore or Undo." }, when: { status: ["active", "revoked"] } },
        { id: "revoke_block", label: "KILL + suspend account", danger: true, input: { key: "reason", label: "Reason (also suspends the linked account for 30 days)" }, when: { status: ["active", "revoked"], account: ["linked"] } },
        { id: "revoke_soft", label: "Soft revoke (copy must re-register)", input: { key: "reason", label: "Reason" }, when: { status: ["active"] } },
        { id: "restore", label: "Restore / undo kill", when: { status: ["revoked", "killed"] } },
      ],
    });
  },

  // ------------------------------------------------------------------ integrity centre (detections feed)
  async integrity() {
    await distReady();
    const rows = [];
    for (const e of await identityDb.prepare("SELECT * FROM dist_events WHERE kind IN ('attest_fail','unknown_version','revoke','clone_beacon') AND created_at > ? ORDER BY created_at DESC LIMIT 200").all(since(14))) {
      const d = P(e.detail, {});
      rows.push({ id: e.id, when: ts(e.created_at), type: e.kind === "attest_fail" ? "failed attestation" : e.kind === "unknown_version" ? "unknown version" : e.kind === "revoke" ? "install revoked" : "cloned site", detail: cut(d.reason ? d.reason : J({ ...d, ai: undefined }), 110), version: e.version_code ?? "", country: e.country || "", device: d.device?.model || "", ai: cut(d.ai, 140) });
    }
    const heavy = await identityDb.prepare("SELECT u.install_id, u.n FROM dist_usage u WHERE u.day = ? ORDER BY u.n DESC LIMIT 10").all(now().slice(0, 10));
    for (const h of heavy) rows.push({ id: `use:${h.install_id}`, when: "today", type: "usage", detail: `${h.n} requests from install ${h.install_id.slice(0, 8)}`, version: "", country: "", device: "", ai: "" });
    const s = await settings(); const fails15 = await num("SELECT COUNT(*) n FROM dist_events WHERE kind = 'attest_fail' AND created_at > ?", new Date(Date.now() - 15 * 60000).toISOString());
    const reasons = await identityDb.prepare("SELECT detail FROM dist_events WHERE kind = 'attest_fail' AND created_at > ? LIMIT 500").all(since(1)); const by = {}; for (const r of reasons) { const k = (P(r.detail).reason || "other").replace(/:.*/, "").slice(0, 40); by[k] = (by[k] || 0) + 1; }
    return tbl([col("when", "When"), col("type", "Type"), col("detail", "Detail"), col("version", "Version code"), col("country", "Country"), col("device", "Device"), col("ai", "AI note")], rows, {
      chips: "type", summary: [["Failed checks, last 15 min", `${fails15} (alert at ${s.spike_threshold})`], ["Failed checks, 24 h", reasons.length], ["Top reasons (24 h)", Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ×${v}`).join(" · ") || "none"], ["Open fake reports", await num("SELECT COUNT(*) n FROM dist_reports WHERE status = 'open'")], ["Look-alikes to review", await num("SELECT COUNT(*) n FROM dist_lookalikes WHERE status = 'suspected'")]],
      actions: [{ id: "ai_triage", label: "Ask AI to triage", when: { type: ["failed attestation", "unknown version", "usage"] } }],
    });
  },

  // ------------------------------------------------------------------ policy (settings rows, same pattern as Feed Controls)
  async distpolicy() {
    await distReady(); const s = await settings(true);
    const rows = [
      { id: "mode", setting: "Verification mode", value: s.mode, what: "off · monitor (record and alert, never block) · enforce (apps that fail verification are refused). Start on monitor, check Integrity Center for a week, then enforce." },
      { id: "min_version_code", setting: "Minimum app version code", value: s.min_version_code, what: "Apps older than this are told to update and cannot continue. 0 = no minimum." },
      { id: "min_trust", setting: "Minimum device trust (when enforcing)", value: s.min_trust, what: "none · software · hardware. Hardware refuses phones without a hardware-backed key (some older and budget phones)." },
      { id: "allowed_certs", setting: "Official signing certificates (SHA-256)", value: (await officialCerts()).map((c) => c.slice(0, 8) + "…").join(", ") || "none set", what: "Comma-separated SHA-256 of every certificate your official APKs are signed with (include a store's re-signing cert if it has one). Also read from DIST_APK_CERTS." },
      { id: "package_name", setting: "Android package name", value: s.package_name, what: "The only package name accepted at registration." },
      { id: "official_domains", setting: "Official domains", value: (await officialDomains()).join(", "), what: "Listed in the manifest and used to recognise your own website code running on another domain." },
      { id: "spike_threshold", setting: "Failure-spike alert threshold", value: `${s.spike_threshold} in 15 min`, what: "How many failed verifications in 15 minutes raise a spike alert." },
      { id: "usage_daily_limit", setting: "Requests per install per day", value: s.usage_daily_limit, what: "An install above this is flagged as abnormal." },
      { id: "manifest_ttl_hours", setting: "Manifest validity (hours)", value: s.manifest_ttl_hours, what: "How long a signed manifest is considered fresh. Short = fakes cannot replay an old copy for long." },
      { id: "lease_ttl_minutes", setting: "Licence lease length (minutes)", value: s.lease_ttl_minutes, what: "How long a signed licence lease keeps the app running without contacting the server (offline grace). Shorter = a killed phone that stays offline dies sooner; longer = fewer lock-outs for people with poor signal. 1440 = 24 h." },
      { id: "require_lease", setting: "Require a valid licence lease", value: s.require_lease === "1" ? "on" : "off", what: "On: the app refuses to open until it holds a valid lease (the real defence against a killed copy used offline). Turn on after most users have updated; people offline longer than the lease length see 'Connect to continue' until they reconnect." },
      { id: "collect_details", setting: "Record IP and approximate location of installs", value: s.collect_details === "1" ? "on" : "off", what: "On: installs store an encrypted IP address and network location that admins can see. Disclose this in the privacy policy. Precise GPS is only ever stored if the person agrees on their device." },
      { id: "tamper_action", setting: "When the app detects a debugger / Frida / Xposed", value: s.tamper_action, what: "report (tell the server, keep working) or block (the app refuses to run). Block can stop legitimate rooted/modded users, so start with report." },
      { id: "apk_enabled", setting: "Android APK downloads", value: s.apk_enabled === "1" ? "on" : "off", what: "On: the install page offers the APK and the web app. Off: /install offers the web app only, for every device, and /dl/apk stops serving. Apps already installed keep working and can still update." },
      { id: "pwa_enabled", setting: "Web app (PWA)", value: s.pwa_enabled === "1" ? "on" : "off", what: "Shows web-app install steps for every device and tracks web-app installs." },
      { id: "clone_alerts", setting: "Alert when our website code runs on another domain", value: s.clone_alerts === "1" ? "on" : "off", what: "A tiny beacon in the web app reports when it is served from a domain that is not yours." },
      { id: "ai_enabled", setting: "AI assistant (advisory only)", value: s.ai_enabled === "1" ? "on" : "off", what: "Drafts triage notes and report text. It never takes an action. Needs the server's AI key (see AI Health Check)." },
    ];
    return tbl([col("setting", "Setting"), col("value", "Value"), col("what", "What it does")], rows, { actions: [{ id: "set", label: "Change", input: { key: "value", label: "New value" } }], summary: [["Manifest sequence", s.manifest_seq]] });
  },

  // ------------------------------------------------------------------ feature kills
  async distkills() {
    await distReady();
    const rows = (await identityDb.prepare("SELECT * FROM dist_kills ORDER BY created_at DESC").all()).map((k) => ({ id: k.id, feature: k.feature, versions: k.max_code >= 2147483647 ? `${k.min_code} and up` : `${k.min_code} – ${k.max_code}`, state: k.active ? "on (feature disabled)" : "off", reason: cut(k.reason, 80), created: ts(k.created_at) }));
    const f = [{ key: "feature", label: "Feature key (e.g. voice_rooms, jobs, uploads, messaging)" }, { key: "min_code", label: "From version code", optional: true }, { key: "max_code", label: "Up to version code (blank = all newer too)", optional: true }, { key: "reason", label: "Reason", long: true, optional: true }];
    return tbl([col("feature", "Feature"), col("versions", "App versions affected"), col("state", "State"), col("reason", "Reason"), col("created", "Created")], rows, { create: f, createLabel: "+ Switch a feature off for a version", actions: [{ id: "lift", label: "Switch back on", when: { state: ["on (feature disabled)"] } }, { id: "reapply", label: "Disable again", when: { state: ["off"] } }, { id: "delete", label: "Delete", danger: true }] });
  },

  // ------------------------------------------------------------------ look-alikes and APK sites
  async lookalikes() {
    await distReady();
    const rows = (await identityDb.prepare("SELECT * FROM dist_lookalikes ORDER BY CASE status WHEN 'suspected' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, first_seen DESC LIMIT 300").all()).map((l) => { const ev = P(l.evidence, {}); return { id: l.id, target: cut(l.target, 60), kind: l.kind, status: l.status, similarity: l.similarity ?? "", http: l.http_status ?? "", signals: cut((ev.signals || []).join("; ") || ev.note || "", 90), registrar: l.registrar || "", found: ts(l.first_seen), reported: ts(l.reported_at), ai: cut(l.ai_note, 120) }; });
    const f = [{ key: "target", label: "Domain or page URL" }, { key: "kind", label: "Type", options: [["domain", "Look-alike domain"], ["apk_site", "APK listing on another site"]] }, { key: "notes", label: "Notes", long: true, optional: true }];
    return tbl([col("target", "Target"), col("kind", "Type"), col("status", "Status"), col("similarity", "Similarity"), col("http", "HTTP"), col("signals", "What we saw"), col("registrar", "Registrar"), col("found", "First seen"), col("reported", "Reported"), col("ai", "AI note")], rows, {
      chips: "status", detail: true, create: f, createLabel: "+ Add a site to watch", summary: [["Suspected", rows.filter((r) => r.status === "suspected").length], ["Confirmed", rows.filter((r) => r.status === "confirmed").length], ["Reported", rows.filter((r) => r.status === "reported").length], ["Taken down", rows.filter((r) => r.status === "taken_down").length]],
      actions: [
        { id: "scan", label: "Check now" }, { id: "ai_assess", label: "Ask AI to assess" },
        { id: "confirm", label: "Confirm it's a fake", when: { status: ["suspected"] } }, { id: "dismiss", label: "Dismiss (harmless)", when: { status: ["suspected", "confirmed"] } },
        { id: "report_kit", label: "Prepare reports (host, registrar, Google)", when: { status: ["confirmed", "reported"] } },
        { id: "mark_reported", label: "Mark reported", when: { status: ["confirmed"] } }, { id: "taken_down", label: "Mark taken down", when: { status: ["reported", "confirmed"] } },
      ],
    });
  },

  // ------------------------------------------------------------------ user reports
  async fakereports() {
    await distReady();
    const rows = (await identityDb.prepare("SELECT * FROM dist_reports ORDER BY created_at DESC LIMIT 300").all()).map((r) => ({ id: r.id, kind: r.kind, target: cut(r.target, 60), detail: cut(r.detail, 140), status: r.status, when: ts(r.created_at), ai: cut(r.ai_note, 120) }));
    return tbl([col("when", "When"), col("kind", "What"), col("target", "Where / what"), col("detail", "What the person said"), col("status", "Status"), col("ai", "AI note")], rows, {
      chips: "status", summary: [["Open", rows.filter((r) => r.status === "open").length]],
      actions: [{ id: "to_lookalike", label: "Add to look-alikes", when: { status: ["open"] } }, { id: "resolve", label: "Resolve", when: { status: ["open"] } }, { id: "dismiss", label: "Dismiss", when: { status: ["open"] } }, { id: "ai_triage", label: "Ask AI to triage" }],
    });
  },
};

const sha64 = (v, label) => { const h = normHex(v); if (h.length !== 64) throw bad(`${label} must be 64 hex characters (SHA-256).`); return h.toLowerCase(); };
const urlOk = (u, label = "URL") => { try { const x = new URL(u); if (x.protocol !== "https:") throw 0; return x.toString(); } catch { throw bad(`${label} must be a valid https:// link.`); } };
const isSection = (staff, perm) => can(staff.role, perm);

export const ACT = {
  async distreleases(staff, id, a, b) {
    if (!isSection(staff, "distribution.release")) throw bad("Your role can't change releases.", 403);
    const r = await identityDb.prepare("SELECT * FROM dist_releases WHERE id = ?").get(id); if (!r) throw bad("No such release.", 404);
    const set = (sql, ...p) => identityDb.prepare(sql).run(...p, id);
    if (a === "publish") await set("UPDATE dist_releases SET status = 'live', published_at = COALESCE(published_at, ?) WHERE id = ?", now());
    else if (a === "pause") await set("UPDATE dist_releases SET status = 'paused' WHERE id = ?");
    else if (a === "rollout") { const n = Math.round(+b.value); if (!(n >= 1 && n <= 100)) throw bad("Enter a number from 1 to 100."); await set("UPDATE dist_releases SET rollout_pct = ? WHERE id = ?", n); }
    else if (a === "mandatory_on") await set("UPDATE dist_releases SET mandatory = 1 WHERE id = ?");
    else if (a === "mandatory_off") await set("UPDATE dist_releases SET mandatory = 0 WHERE id = ?");
    else if (a === "delete_release") {
      if (!isSection(staff, "distribution.respond")) throw bad("Your role can't delete releases.", 403);
      if (String(b.confirm || "").trim() !== r.version_name) throw bad(`Type exactly ${r.version_name} to confirm.`);
      const out = await deleteRelease(staff, id, `release ${r.version_name} deleted by staff`); await logStaff(staff, "dist_release_delete", `${r.version_name} (${r.version_code})`, `${out.revoked} installs revoked`); return;
    } else if (a === "withdraw") {
      const why = need(b, "reason", "Say why this version is being withdrawn."); await set("UPDATE dist_releases SET status = 'revoked' WHERE id = ?");
      if (isSection(staff, "distribution.respond")) { const n = await revokeByVersion(staff, r.version_code, why); await logStaff(staff, "dist_withdraw_release", r.version_name, `${why} (${n} installs revoked)`); } // a withdrawn build's installs must re-register on a good one
    } else throw bad("Unknown action.");
    await bumpManifest(); await logStaff(staff, `dist_release_${a}`, `${r.version_name} (${r.version_code})`, b?.value || b?.reason || null);
  },
  async distchannels(staff, id, a, b) {
    if (!isSection(staff, "distribution.manage")) throw bad("Your role can't change channels.", 403);
    if (a === "hide") await identityDb.prepare("UPDATE dist_channels SET enabled = 0, updated_at = ? WHERE id = ?").run(now(), id);
    else if (a === "show") await identityDb.prepare("UPDATE dist_channels SET enabled = 1, updated_at = ? WHERE id = ?").run(now(), id);
    else if (a === "delete") await identityDb.prepare("DELETE FROM dist_channels WHERE id = ?").run(id);
    else if (a === "edit") await identityDb.prepare("UPDATE dist_channels SET label = ?, kind = ?, url = ?, cert_sha256 = ?, fingerprint = ?, notes = ?, updated_at = ? WHERE id = ?").run(need(b, "label"), b.kind || "mirror", urlOk(b.url), b.cert_sha256 ? sha64(b.cert_sha256, "Certificate") : null, b.fingerprint || null, b.notes || null, now(), id);
    else throw bad("Unknown action.");
    await bumpManifest(); await logStaff(staff, `dist_channel_${a}`, id);
  },
  async distinstalls(staff, id, a, b) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't revoke installs.", 403);
    if (a === "revoke") { await killInstall(staff, id, need(b, "reason", "Give a reason.")); return { _audited: true, message: "Killed. The app will lock and wipe itself; this device is blocked." }; }
    if (a === "revoke_block") { await revokeAndBlock(staff, id, need(b, "reason", "Give a reason.")); return { _audited: true, message: "Killed and the account is suspended for 30 days." }; }
    if (a === "restore") { const st = (await identityDb.prepare("SELECT status FROM dist_installs WHERE install_id = ?").get(id))?.status; if (st === "killed") await restoreKilled(staff, id); else await restoreInstall(staff, id); }
    else if (a === "revoke_soft") await revokeInstall(staff, id, need(b, "reason", "Give a reason."));
    else throw bad("Unknown action.");
    await logStaff(staff, `dist_install_${a}`, id.slice(0, 8), b?.reason || null);
  },
  async integrity(staff, id, a) {
    if (a !== "ai_triage") throw bad("Unknown action.");
    if (!isSection(staff, "distribution.ai")) throw bad("Your role can't use the AI assistant.", 403);
    const ev = await identityDb.prepare("SELECT kind, version_code, country, detail, created_at FROM dist_events WHERE id = ?").get(id);
    const ai = await import("./ai.js"); const note = await ai.triageDetection(ev ? { kind: ev.kind, versionCode: ev.version_code, country: ev.country, detail: P(ev.detail), at: ev.created_at } : { usage: id });
    await identityDb.prepare("UPDATE dist_events SET detail = ? WHERE id = ?").run(J({ ...P(ev?.detail), ai: note }), id).catch(() => {});
    await logStaff(staff, "dist_ai_triage", id);
    return { note };
  },
  async distpolicy(staff, id, a, b) {
    if (!isSection(staff, "distribution.manage")) throw bad("Your role can't change distribution policy.", 403);
    if (a !== "set") throw bad("Unknown action.");
    const v = String(b.value ?? "").trim(); const onoff = () => { const x = v.toLowerCase(); if (!["on", "off"].includes(x)) throw bad("Type on or off."); return x === "on" ? "1" : "0"; };
    const int = (lo, hi) => { const n = Math.round(+v); if (!(n >= lo && n <= hi)) throw bad(`Enter a number from ${lo} to ${hi}.`); return String(n); };
    let val;
    switch (id) {
      case "mode": if (!["off", "monitor", "enforce"].includes(v)) throw bad("Type off, monitor or enforce."); val = v; if (v === "enforce" && !(await officialCerts()).length) throw bad("Add at least one official signing certificate before enforcing, or every app would be refused."); break;
      case "min_version_code": val = int(0, 2147483646); break;
      case "tamper_action": if (!["report", "block"].includes(v)) throw bad("Type report or block."); val = v; break;
      case "min_trust": if (!["none", "software", "hardware"].includes(v)) throw bad("Type none, software or hardware."); val = v; break;
      case "allowed_certs": val = list(v).map((x) => sha64(x, "Each certificate")).join(","); break;
      case "package_name": if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(v)) throw bad("That is not a valid Android package name."); val = v; break;
      case "official_domains": val = list(v).map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).join(","); break;
      case "spike_threshold": val = int(2, 500); break; case "usage_daily_limit": val = int(100, 1000000); break; case "manifest_ttl_hours": val = int(1, 720); break;
      case "pwa_enabled": case "apk_enabled": case "clone_alerts": case "ai_enabled": val = onoff(); if (id === "apk_enabled" && val === "0" && (await settings(true)).pwa_enabled !== "1") throw bad("Turn the web app on first, otherwise nobody could install LinkedOut."); break;
      case "lease_ttl_minutes": val = int(15, 43200); break;
      case "require_lease": case "collect_details": val = onoff(); break;
      default: throw bad("Unknown setting.");
    }
    const prev = (await settings(true))[id];
    await putSetting(staff, id, val);
    await logStaff(staff, "dist_policy_change", id, `${prev} → ${val}`, { kind: "setting", data: { key: id, prev } });    // undoable from Action History
    return { _audited: true };
  },
  async distkills(staff, id, a) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't change feature switches.", 403);
    if (a === "lift") await identityDb.prepare("UPDATE dist_kills SET active = 0 WHERE id = ?").run(id);
    else if (a === "reapply") await identityDb.prepare("UPDATE dist_kills SET active = 1 WHERE id = ?").run(id);
    else if (a === "delete") await identityDb.prepare("DELETE FROM dist_kills WHERE id = ?").run(id);
    else throw bad("Unknown action.");
    await logStaff(staff, `dist_kill_${a}`, id);
  },
  async lookalikes(staff, id, a, b) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't handle look-alikes.", 403);
    const l = await identityDb.prepare("SELECT * FROM dist_lookalikes WHERE id = ?").get(id); if (!l) throw bad("No such entry.", 404);
    const set = (status) => identityDb.prepare("UPDATE dist_lookalikes SET status = ? WHERE id = ?").run(status, id);
    const la = await import("./lookalike.js");
    if (a === "confirm") await set("confirmed"); else if (a === "dismiss") await set("dismissed"); else if (a === "taken_down") await set("taken_down");
    else if (a === "mark_reported") await identityDb.prepare("UPDATE dist_lookalikes SET status = 'reported', reported_at = ? WHERE id = ?").run(now(), id);
    else if (a === "scan") { const r = l.kind === "apk_site" ? await la.scanApkSites() : await la.inspectHost(l.target); await identityDb.prepare("UPDATE dist_lookalikes SET last_checked = ? WHERE id = ?").run(now(), id); if (r && !Array.isArray(r)) await identityDb.prepare("UPDATE dist_lookalikes SET similarity = ?, http_status = ?, evidence = ? WHERE id = ?").run(r.score, r.status, J({ ips: r.ips, title: r.title, signals: r.signals }), id); }
    else if (a === "ai_assess") { if (!isSection(staff, "distribution.ai")) throw bad("Your role can't use the AI assistant.", 403); const note = await (await import("./ai.js")).assessLookalike(l); await identityDb.prepare("UPDATE dist_lookalikes SET ai_note = ? WHERE id = ?").run(note, id); }
    else if (a === "report_kit") {
      const who = await la.whoToReport(l.target); const dom = await officialDomains(); let text = la.reportText(l, who, dom);
      if ((await settings()).ai_enabled === "1" && isSection(staff, "distribution.ai")) { try { text = await (await import("./ai.js")).polishReport(text); } catch { /* keep the plain template */ } }
      await identityDb.prepare("UPDATE dist_lookalikes SET registrar = ?, abuse_contact = ?, host_ns = ?, notes = ? WHERE id = ?").run(who.registrar || null, [who.registrarAbuse, who.hostAbuse].filter(Boolean).join(", ") || null, J({ ns: who.nameservers, ips: who.ips, hostOrg: who.hostOrg }), `REPORT KIT\nRegistrar: ${who.registrar || "?"} (${who.registrarAbuse || "no abuse email found"})\nHost: ${who.hostOrg || "?"} (${who.hostAbuse || "no abuse email found"})\nOther places: ${la.REPORT_CHANNELS.map(([n, f]) => `${n}: ${f(l.target)}`).join(" | ")}\n\n${text}`, id);
    } else throw bad("Unknown action.");
    await logStaff(staff, `dist_lookalike_${a}`, l.target);
  },
  async fakereports(staff, id, a) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't handle reports.", 403);
    const r = await identityDb.prepare("SELECT * FROM dist_reports WHERE id = ?").get(id); if (!r) throw bad("No such report.", 404);
    if (a === "ai_triage") { if (!isSection(staff, "distribution.ai")) throw bad("Your role can't use the AI assistant.", 403); const note = await (await import("./ai.js")).triageDetection({ kind: r.kind, target: r.target, text: r.detail }); await identityDb.prepare("UPDATE dist_reports SET ai_note = ? WHERE id = ?").run(note, id); }
    else if (a === "to_lookalike") { const t = String(r.target || "").trim(); if (!t) throw bad("This report has no site or link to track."); await identityDb.prepare("INSERT INTO dist_lookalikes (id, target, kind, source, status, evidence, first_seen) VALUES (?,?,?,?,?,?,?) ON CONFLICT (target) DO NOTHING").run(uid(), t.slice(0, 200), /^https?:\/\//.test(t) ? "apk_site" : "domain", "user-report", "suspected", J({ note: "Reported by a user", text: String(r.detail || "").slice(0, 300) }), now()); await identityDb.prepare("UPDATE dist_reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?").run(staff.id, now(), id); }
    else if (a === "resolve" || a === "dismiss") await identityDb.prepare("UPDATE dist_reports SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?").run(a === "resolve" ? "resolved" : "dismissed", staff.id, now(), id);
    else throw bad("Unknown action.");
    await logStaff(staff, `dist_report_${a}`, id.slice(0, 8));
  },
};

export const CREATE = {
  async distreleases(staff, b) {
    if (!isSection(staff, "distribution.release")) throw bad("Your role can't register releases.", 403); await distReady();
    const code = Math.round(+b.version_code); if (!(code > 0)) throw bad("Version code must be a positive whole number.");
    const newest = await identityDb.prepare("SELECT MAX(version_code) m FROM dist_releases").get(); if (newest?.m && code <= +newest.m) throw bad(`Version code must be higher than the latest one (${newest.m}).`);
    const mirrors = String(b.mirror_urls || "").split(/\s+/).filter(Boolean).map((u) => urlOk(u, "Mirror URL")); const pct = b.rollout_pct ? Math.round(+b.rollout_pct) : 100; if (!(pct >= 1 && pct <= 100)) throw bad("Rollout must be 1–100.");
    await identityDb.prepare("INSERT INTO dist_releases (id, version_name, version_code, sha256, size_bytes, cert_sha256, url, mirror_urls, notes, min_supported, rollout_pct, status, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(uid(), need(b, "version_name"), code, sha64(b.sha256, "SHA-256"), b.size_bytes ? Math.round(+b.size_bytes) : null, b.cert_sha256 ? sha64(b.cert_sha256, "Certificate") : null, urlOk(b.url, "APK URL"), J(mirrors), b.notes || null, Math.max(0, Math.round(+b.min_supported || 0)), pct, "draft", staff.id, now());
    await logStaff(staff, "dist_release_create", `${b.version_name} (${code})`);
  },
  async distchannels(staff, b) {
    if (!isSection(staff, "distribution.manage")) throw bad("Your role can't add channels.", 403); await distReady();
    await identityDb.prepare("INSERT INTO dist_channels (id, kind, label, url, cert_sha256, fingerprint, notes, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(uid(), b.kind || "mirror", need(b, "label"), urlOk(b.url), b.cert_sha256 ? sha64(b.cert_sha256, "Certificate") : null, b.fingerprint || null, b.notes || null, now());
    await bumpManifest(); await logStaff(staff, "dist_channel_create", b.label);
  },
  async distkills(staff, b) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't change feature switches.", 403); await distReady();
    const f = need(b, "feature", "Name the feature.").toLowerCase(); if (!/^[a-z0-9_]{2,32}$/.test(f)) throw bad("Feature keys use letters, numbers and underscores.");
    await identityDb.prepare("INSERT INTO dist_kills (id, feature, min_code, max_code, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)").run(uid(), f, Math.max(0, Math.round(+b.min_code || 0)), b.max_code ? Math.round(+b.max_code) : 2147483647, b.reason || null, staff.id, now());
    await logStaff(staff, "dist_kill_create", f, b.reason || null);
  },
  async lookalikes(staff, b) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't add look-alikes.", 403); await distReady();
    const t = need(b, "target").toLowerCase().replace(/^https?:\/\//, b.kind === "apk_site" ? "https://" : "").replace(/\/$/, "");
    await identityDb.prepare("INSERT INTO dist_lookalikes (id, target, kind, source, status, notes, first_seen) VALUES (?,?,?,?,?,?,?) ON CONFLICT (target) DO NOTHING").run(uid(), t.slice(0, 250), b.kind || "domain", "manual", "suspected", b.notes || null, now());
    await logStaff(staff, "dist_lookalike_add", t);
  },
};
export const DETAIL = {
  async lookalikes(staff, id) {
    const l = await identityDb.prepare("SELECT * FROM dist_lookalikes WHERE id = ?").get(id); if (!l) throw bad("No such entry.", 404);
    const ev = P(l.evidence, {}), ns = P(l.host_ns, {});
    const kv = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k, String(v)]);
    return { title: l.target, status: l.status, blocks: [
      { title: "What we saw", rows: kv({ Type: l.kind, Source: l.source, Similarity: l.similarity, "HTTP status": l.http_status, "Page title": ev.title, Signals: (ev.signals || []).join("; ") || ev.note, Resolves_to: (ev.ips || ns.ips || []).join(", "), "First seen": ts(l.first_seen), "Last checked": ts(l.last_checked) }) },
      { title: "Who to report to", rows: kv({ Registrar: l.registrar, "Abuse contacts": l.abuse_contact, "Host": ns.hostOrg, Nameservers: (ns.ns || []).join(", "), Reported: ts(l.reported_at) }) },
      ...(l.ai_note ? [{ title: "AI note (advisory)", rows: [["Draft", l.ai_note]] }] : []),
      ...(l.notes ? [{ title: "Notes and report kit", rows: [["Text", l.notes]] }] : []),
    ] };
  },
};

// ====================================================================== web-app (PWA) installs, security actions, detail pages
const kv = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => [k.replace(/_/g, " "), String(v)]);
const acct = async (id) => { if (!id) return null; const a = await identityDb.prepare("SELECT pseudonym, status, role, created_at FROM accounts WHERE id = ?").get(id).catch(() => null); return a || null; };
const timeline = async (where, ...p) => (await identityDb.prepare(`SELECT kind, version_code, country, detail, created_at FROM dist_events WHERE ${where} ORDER BY created_at DESC LIMIT 15`).all(...p)).map((e) => { const why = (P(e.detail, {}) || {}).reason; return [ts(e.created_at), `${e.kind}${e.version_code ? " · v" + e.version_code : ""}${e.country ? " · " + e.country : ""}${why ? " · " + cut(String(why), 80) : ""}`]; });

Object.assign(LIST, {
  async distpwa() {
    await distReady();
    const pushBy = new Map((await identityDb.prepare("SELECT account_id, COUNT(*) n FROM push_tokens WHERE platform = 'web' GROUP BY account_id").all()).map((r) => [r.account_id, +r.n]));
    const rows = (await identityDb.prepare("SELECT p.*, a.pseudonym, a.email, a.real_name FROM dist_pwa p LEFT JOIN accounts a ON a.id = p.account_id ORDER BY p.last_seen DESC LIMIT 400").all()).map((p) => ({
      name: p.real_name || "", email: p.email || "", ip: ipOf(p.ip_enc), place: placeText(geoOf(p.geo), preciseOf(p.precise)), exact: preciseOf(p.precise) ? mapsLink(preciseOf(p.precise).lat, preciseOf(p.precise).lon) : "",
      id: p.device_id, device: p.device_id.slice(0, 8), status: p.status, platform: p.platform, os: `${p.os}${p.os_version ? " " + p.os_version : ""}`, browser: `${p.browser}${p.browser_version ? " " + p.browser_version : ""}`, form: p.form, account: p.pseudonym || (p.account_id ? "linked" : ""), country: p.country || "",
      opens: +p.opens, push: p.account_id ? (pushBy.get(p.account_id) || 0) : 0, build: p.build || "", firstSeen: ts(p.first_seen), lastSeen: ts(p.last_seen), note: cut(p.note, 60) }));
    return tbl([col("device", "Device"), col("status", "Status"), col("name", "Name"), col("email", "Email"), col("ip", "IP address"), col("place", "Location"), col("exact", "Exact position (consented)"), col("platform", "Platform"), col("os", "OS"), col("browser", "Browser"), col("form", "Type"), col("account", "Account"), col("country", "Country"), col("opens", "Opens"), col("push", "Push devices"), col("build", "Build"), col("lastSeen", "Last seen"), col("firstSeen", "Installed"), col("note", "Note")], rows, {
      chips: "platform", detail: true,
      summary: [["Web-app devices", rows.length], ["iPhone / iPad", rows.filter((r) => r.platform === "ios").length], ["Android", rows.filter((r) => r.platform === "android").length], ["Desktop", rows.filter((r) => r.platform === "desktop").length], ["Flagged", rows.filter((r) => r.status === "flagged").length]],
      actions: [
        { id: "flag", label: "Flag", input: { key: "reason", label: "Why? (note kept on the device record)" }, when: { status: ["active"] } }, { id: "unflag", label: "Clear flag", when: { status: ["flagged"] } },
        { id: "kill_web", label: "KILL this web app (sign out, clear data, lock)", danger: true, input: { key: "reason", label: "Reason. The browser clears its data and shows a locked screen; the account is signed out everywhere on this device." }, when: { status: ["active", "flagged"] } },
        { id: "restore_web", label: "Restore", when: { status: ["killed"] } },
        { id: "signout", label: "Sign this device out", confirm: "The next time this web app opens it will be signed out." },
        { id: "disable_push", label: "Stop notifications to this account's web devices", confirm: "Removes every web notification subscription for the linked account. They can turn it on again themselves." },
        { id: "block_account", label: "Block linked account", danger: true, input: { key: "reason", label: "Reason (account suspended for 30 days)" } },
        { id: "forget", label: "Delete record", danger: true },
      ],
    });
  },
  async distactions() {
    await distReady(); const s = await settings(true);
    const cnt = (sql, ...p) => num(sql, ...p);
    const rows = [
      { id: "apk_toggle", action: "Android APK downloads", now: s.apk_enabled === "1" ? "ON" : "OFF (web app only)", effect: "Off: /install shows the web app for every device and /dl/apk stops serving. Installed apps keep working." },
      { id: "revoke_old", action: "Revoke installs older than a version", now: `${await cnt("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active'")} active installs`, effect: "Every active install below the version code you enter is cut off and must update and re-register." },
      { id: "revoke_software", action: "Revoke software-only installs", now: `${await cnt("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active' AND trust <> 'hardware'")} not hardware-backed`, effect: "Cuts off installs whose key is not in secure hardware (emulators, rooted or very old phones)." },
      { id: "revoke_tamper", action: "Revoke installs that reported tampering", now: `${await cnt("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active' AND (flags LIKE '%\"frida\":true%' OR flags LIKE '%\"xposed\":true%' OR flags LIKE '%\"tracer\":true%' OR flags LIKE '%\"debugger\":true%')")} flagged`, effect: "Cuts off installs that reported Frida, Xposed, a tracer or a debugger when they registered." },
      { id: "revoke_channel", action: "Revoke installs from one channel", now: "enter a channel (website, samsung, huawei…)", effect: "Use after a store listing turns out to be compromised." },
      { id: "revoke_inactive", action: "Revoke installs not seen for N days", now: `${await cnt("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active' AND last_seen < ?", since(90))} unseen for 90+ days`, effect: "Housekeeping: dormant copies must re-register if they ever return." },
      { id: "signout_pwa", action: "Sign out ALL web-app devices", now: `${await cnt("SELECT COUNT(*) n FROM dist_pwa")} devices`, effect: "Each web app signs out the next time it opens. Use after a web-side incident." },
      { id: "revoke_all", action: "EMERGENCY: revoke every Android install", now: `${await cnt("SELECT COUNT(*) n FROM dist_installs WHERE status = 'active'")} active`, effect: "Every app copy must re-register. Genuine copies do it silently; fakes cannot." },
    ];
    return tbl([col("action", "Action"), col("now", "Right now"), col("effect", "What it does")], rows, { actions: [
      { id: "set", label: "Turn on / off", input: { key: "value", label: "on or off" }, when: { id: ["apk_toggle"] } },
      { id: "run", label: "Run", danger: true, input: { key: "value", label: "Value (version code, channel, days) or the word CONFIRM" }, when: { id: ["revoke_old", "revoke_software", "revoke_tamper", "revoke_channel", "revoke_inactive", "signout_pwa", "revoke_all"] } },
    ] });
  },
});

Object.assign(ACT, {
  async distpwa(staff, id, a, b) {
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't respond to web-app installs.", 403);
    const p = await identityDb.prepare("SELECT * FROM dist_pwa WHERE device_id = ?").get(id); if (!p) throw bad("No such device.", 404);
    if (a === "flag") await identityDb.prepare("UPDATE dist_pwa SET status = 'flagged', note = ?, flagged_by = ? WHERE device_id = ?").run(need(b, "reason", "Give a reason.").slice(0, 200), staff.id, id);
    else if (a === "unflag") await identityDb.prepare("UPDATE dist_pwa SET status = 'active', note = NULL WHERE device_id = ?").run(id);
    else if (a === "kill_web") { await identityDb.prepare("UPDATE dist_pwa SET status = 'killed', kill_reason = ?, pending_signout = 1, flagged_by = ? WHERE device_id = ?").run(need(b, "reason", "Give a reason.").slice(0, 200), staff.id, id); if (p.account_id) { const { invalidateSession } = await import("@/lib/session-cache"); invalidateSession(p.account_id); } await logStaff(staff, "dist_pwa_kill", id.slice(0, 8), b.reason, { kind: "pwa", data: { id, prev: p.status } }); return { _audited: true, message: "Killed. It locks the next time it opens or checks in." }; }
    else if (a === "restore_web") await identityDb.prepare("UPDATE dist_pwa SET status = 'active', kill_reason = NULL WHERE device_id = ?").run(id);
    else if (a === "signout") { await identityDb.prepare("UPDATE dist_pwa SET pending_signout = 1 WHERE device_id = ?").run(id); if (p.account_id) { const { invalidateSession } = await import("@/lib/session-cache"); invalidateSession(p.account_id); } }
    else if (a === "block_account") { if (!p.account_id) throw bad("No account is linked to this device."); const { applyEnforcement } = await import("@/lib/admin/enforce"); await applyEnforcement(staff, p.account_id, "temp_suspend", { reason: `Web-app integrity: ${need(b, "reason", "Give a reason.")}`, days: 30 }); }
    else if (a === "disable_push") { if (!p.account_id) throw bad("No account is linked to this device."); await identityDb.prepare("DELETE FROM push_tokens WHERE account_id = ? AND platform = 'web'").run(p.account_id); }
    else if (a === "forget") await identityDb.prepare("DELETE FROM dist_pwa WHERE device_id = ?").run(id);
    else throw bad("Unknown action.");
    await logStaff(staff, `dist_pwa_${a}`, id.slice(0, 8), b?.reason || null);
  },
  async distactions(staff, id, a, b) {
    const v = String(b?.value ?? "").trim(); const confirm = () => { if (v.toUpperCase() !== "CONFIRM") throw bad("Type CONFIRM to run this."); };
    if (id === "apk_toggle") {
      if (!isSection(staff, "distribution.manage")) throw bad("Your role can't change distribution policy.", 403);
      const x = v.toLowerCase(); if (!["on", "off"].includes(x)) throw bad("Type on or off.");
      if (x === "off" && (await settings(true)).pwa_enabled !== "1") throw bad("Turn the web app on first, otherwise nobody could install LinkedOut.");
      await putSetting(staff, "apk_enabled", x === "on" ? "1" : "0"); await logStaff(staff, "dist_apk_toggle", x); return;
    }
    if (!isSection(staff, "distribution.respond")) throw bad("Your role can't run security actions.", 403);
    let n = 0, label = id;
    if (id === "revoke_old") { const c = Math.round(+v); if (!(c > 0)) throw bad("Enter a version code (a whole number)."); n = await revokeWhere(staff, "version_code < ?", [c], `older than version ${c}`); }
    else if (id === "revoke_software") { confirm(); n = await revokeWhere(staff, "trust <> 'hardware'", [], "software-only key (bulk action)"); }
    else if (id === "revoke_tamper") { confirm(); n = await killWhere(staff, `flags LIKE '%"frida":true%' OR flags LIKE '%"xposed":true%' OR flags LIKE '%"tracer":true%' OR flags LIKE '%"debugger":true%'`, [], "reported tampering (bulk action)"); }
    else if (id === "revoke_channel") { if (!/^[a-z0-9_-]{2,24}$/i.test(v)) throw bad("Enter a channel name such as website or samsung."); n = await revokeWhere(staff, "channel = ?", [v], `channel ${v} withdrawn`); label += ":" + v; }
    else if (id === "revoke_inactive") { const d = Math.round(+v); if (!(d >= 7 && d <= 1000)) throw bad("Enter a number of days from 7 to 1000."); n = await revokeWhere(staff, "last_seen < ?", [since(d)], `inactive for ${d}+ days`); }
    else if (id === "signout_pwa") { confirm(); const r = await identityDb.prepare("UPDATE dist_pwa SET pending_signout = 1").run(); n = r.changes; }
    else if (id === "revoke_all") { if (v !== "REVOKE ALL") throw bad("Type REVOKE ALL to run this."); n = await revokeWhere(staff, "1 = 1", [], "emergency revoke of all installs"); }
    else throw bad("Unknown action.");
    await logStaff(staff, `dist_bulk_${id}`, label, `${n} affected`);
  },
});

Object.assign(DETAIL, {
  async distinstalls(staff, id) {
    const i = await identityDb.prepare("SELECT * FROM dist_installs WHERE install_id = ?").get(id); if (!i) throw bad("No such install.", 404);
    const at = P(i.attest, {}), d = P(i.device, {}), f = P(i.flags, {}); const a = await acct(i.account_id);
    const use = await identityDb.prepare("SELECT day, n FROM dist_usage WHERE install_id = ? ORDER BY day DESC LIMIT 7").all(id);
    return { title: `Install ${id.slice(0, 8)}`, status: i.status, blocks: [
      { title: "Identity", rows: kv({ "Install ID": i.install_id, Status: i.status, "Revoked because": i.revoke_reason, "Revoked at": ts(i.revoked_at), "Revoked by": i.revoked_by, "First seen": ts(i.first_seen), "Last seen": ts(i.last_seen), Country: i.country, Channel: i.channel, "Installed from": i.installer || "direct / sideload" }) },
      { title: "App", rows: kv({ "Version name": i.version_name, "Version code": i.version_code, "Signing certificate (SHA-256)": i.cert_sha256, Platform: i.platform }) },
      { title: "Device and key storage", rows: kv({ Model: d.model, "Android SDK": d.sdk, "Trust level": i.trust, "Key storage": at.securityLevel === 2 ? "StrongBox" : at.securityLevel === 1 ? "Secure hardware (TEE)" : at.securityLevel === 0 ? "Software only" : "", "Boot state": at.boot, "Bootloader locked": at.locked === null || at.locked === undefined ? "" : at.locked ? "yes" : "NO", "Security patch": at.patch, "Why not full trust": (f.reasons || []).join("; ") }) },
      { title: "Tamper signals reported at setup", rows: kv(Object.fromEntries(Object.entries(f.integrity || {}).map(([k, v]) => [k, v ? "DETECTED" : "clear"]))) },
      { title: "Linked account", rows: a ? kv({ Pseudonym: a.pseudonym, Role: a.role, "Account status": a.status, "Account created": ts(a.created_at) }) : [["Account", "Not signed in yet from this install"]] },
      { title: "Requests per day (last 7)", rows: use.length ? use.map((u) => [u.day, String(u.n)]) : [["Activity", "none recorded"]] },
      { title: "Recent events", rows: await timeline("install_id = ?", id) },
    ] };
  },
  async distpwa(staff, id) {
    const p = await identityDb.prepare("SELECT * FROM dist_pwa WHERE device_id = ?").get(id); if (!p) throw bad("No such device.", 404); const a = await acct(p.account_id);
    return { title: `Web app ${id.slice(0, 8)}`, status: p.status, blocks: [
      { title: "Device", rows: kv({ "Device ID": p.device_id, Platform: p.platform, OS: `${p.os} ${p.os_version || ""}`.trim(), Browser: `${p.browser} ${p.browser_version || ""}`.trim(), Type: p.form, Screen: p.screen, Language: p.lang, "Time zone": p.tz, "Display mode": p.display_mode }) },
      { title: "Usage", rows: kv({ Status: p.status, Note: p.note, "Notification devices (account)": p.account_id ? (await num("SELECT COUNT(*) n FROM push_tokens WHERE account_id = ? AND platform = 'web'", p.account_id)) : "", Opens: p.opens, Build: p.build, Country: p.country, Installed: ts(p.first_seen), "Last seen": ts(p.last_seen), "Sign-out pending": p.pending_signout ? "yes" : "" }) },
      { title: "Linked account", rows: a ? kv({ Pseudonym: a.pseudonym, Role: a.role, "Account status": a.status, "Account created": ts(a.created_at) }) : [["Account", "Not signed in on this device yet"]] },
      { title: "Recent events", rows: await timeline("device_hash = ?", id) },
    ] };
  },
  async distreleases(staff, id) {
    const r = await identityDb.prepare("SELECT * FROM dist_releases WHERE id = ?").get(id); if (!r) throw bad("No such release.", 404);
    const n = await identityDb.prepare("SELECT COUNT(*) n, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) a FROM dist_installs WHERE version_code = ?").get(r.version_code);
    const dls = await num("SELECT COUNT(*) n FROM dist_events WHERE kind = 'download' AND version_code = ?", r.version_code);
    return { title: `Release ${r.version_name}`, status: r.status, blocks: [
      { title: "Release", rows: kv({ "Version name": r.version_name, "Version code": r.version_code, Status: r.status, Rollout: r.rollout_pct + "%", Mandatory: r.mandatory ? "yes" : "", "Oldest allowed": r.min_supported || "", "Min Android SDK": r.min_android || "", Published: ts(r.published_at), Created: ts(r.created_at), "Created by": r.created_by }) },
      { title: "File", rows: kv({ URL: r.url, "Mirror URLs": P(r.mirror_urls, []).join(", "), "SHA-256": r.sha256, "Signing certificate": r.cert_sha256, Size: r.size_bytes ? (r.size_bytes / 1048576).toFixed(1) + " MB" : "", Notes: r.notes }) },
      { title: "Reach", rows: kv({ Downloads: dls, "Installs registered": +n.n || 0, "Installs active": +n.a || 0 }) },
    ] };
  },
});

export { colonHex, DEFAULTS };