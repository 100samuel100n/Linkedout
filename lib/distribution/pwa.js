// Web-app (PWA) installs: tracked per device like Android installs, so the same questions can be answered for both
// (what is it, where, which version, linked to whom, is it behaving) and the same responses applied.
// Privacy: no IP address is stored (salted hash only), no precise location, no UA string is kept; only the parsed family/version.
import { identityDb } from "@/lib/identity/db";
import { distReady, hashIp, now, J } from "./db.js";
import { buildDetails, cleanPrecise } from "./details.js";

export function parseUA(ua = "") {
  const m = (re) => ua.match(re)?.[1] || "";
  let os = "Other", osV = "";
  if (/iPhone|iPad|iPod/.test(ua)) { os = /iPad/.test(ua) ? "iPadOS" : "iOS"; osV = m(/OS (\d+[_\d]*)/).replace(/_/g, "."); }
  else if (/Android/.test(ua)) { os = "Android"; osV = m(/Android (\d+[.\d]*)/); }
  else if (/Windows NT/.test(ua)) { os = "Windows"; osV = m(/Windows NT ([\d.]+)/); }
  else if (/Mac OS X/.test(ua)) { os = "macOS"; osV = m(/Mac OS X (\d+[_.\d]*)/).replace(/_/g, "."); }
  else if (/CrOS/.test(ua)) os = "ChromeOS"; else if (/Linux/.test(ua)) os = "Linux";
  let browser = "Other", bV = "";
  if (/EdgA?\/|Edg\//.test(ua)) { browser = "Edge"; bV = m(/Edg[A]?\/(\d+)/); }
  else if (/SamsungBrowser/.test(ua)) { browser = "Samsung Internet"; bV = m(/SamsungBrowser\/(\d+)/); }
  else if (/OPR\/|Opera/.test(ua)) { browser = "Opera"; bV = m(/OPR\/(\d+)/); }
  else if (/Firefox|FxiOS/.test(ua)) { browser = "Firefox"; bV = m(/(?:Firefox|FxiOS)\/(\d+)/); }
  else if (/CriOS|Chrome\//.test(ua)) { browser = "Chrome"; bV = m(/(?:CriOS|Chrome)\/(\d+)/); }
  else if (/Safari\//.test(ua)) { browser = "Safari"; bV = m(/Version\/(\d+[.\d]*)/); }
  const form = /iPad|Tablet/.test(ua) ? "tablet" : /Mobi|iPhone|Android/.test(ua) ? "phone" : "desktop";
  return { os, osV, browser, bV, form };
}

// Upsert one device. Returns the instruction the browser should follow: { signOut } (set by an admin) and the stored status.
export async function recordPwa({ d, kind, ua, ip, country, accountId, info = {}, headers = null, precise = null }) {
  await distReady();
  const p = parseUA(ua); const t = now();
  const screen = info.w && info.h ? `${Math.min(9999, +info.w | 0)}x${Math.min(9999, +info.h | 0)}@${Math.min(9, +info.dpr || 1)}` : null;
  const clean = (v, n) => (v ? String(v).replace(/[^\w .\-+/_,:]/g, "").slice(0, n) : null);
  const platform = p.os === "iOS" || p.os === "iPadOS" ? "ios" : p.os === "Android" ? "android" : "desktop";
  await identityDb.prepare(`INSERT INTO dist_pwa (device_id, platform, os, os_version, browser, browser_version, form, display_mode, screen, lang, tz, build, country, ip_hash, account_id, opens, first_seen, last_seen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (device_id) DO UPDATE SET os = excluded.os, os_version = excluded.os_version, browser = excluded.browser, browser_version = excluded.browser_version, display_mode = excluded.display_mode,
        screen = COALESCE(excluded.screen, dist_pwa.screen), lang = COALESCE(excluded.lang, dist_pwa.lang), tz = COALESCE(excluded.tz, dist_pwa.tz), build = COALESCE(excluded.build, dist_pwa.build),
        country = COALESCE(excluded.country, dist_pwa.country), ip_hash = excluded.ip_hash, account_id = COALESCE(excluded.account_id, dist_pwa.account_id),
        opens = dist_pwa.opens + ?, last_seen = excluded.last_seen`)
    .run(d, platform, p.os, p.osV || null, p.browser, p.bV || null, p.form, clean(info.display, 20) || "standalone", screen, clean(info.lang, 12), clean(info.tz, 40), clean(info.build, 20), country || null, hashIp(ip), accountId || null, kind === "pwa_open" ? 1 : 0, t, t, kind === "pwa_open" ? 1 : 0);   // first launch sends "install" then "open": counts as one open, not two
  // Encrypted IP + network location for admins, and consented GPS (the page asks first). See details.js.
  try {
    const det = await buildDetails(headers || { get: () => "" }, ip), pr = cleanPrecise(precise);
    if (det.ip_enc || pr) await identityDb.prepare("UPDATE dist_pwa SET ip_enc = COALESCE(?, ip_enc), geo = COALESCE(?, geo), precise = COALESCE(?, precise), ua = COALESCE(?, ua) WHERE device_id = ?").run(det.ip_enc || null, det.geo || null, pr, `${p.os} ${p.osV} · ${p.browser} ${p.bV}`.slice(0, 120), d);
  } catch { /* details are best effort */ }
  const row = await identityDb.prepare("SELECT status, pending_signout, kill_reason FROM dist_pwa WHERE device_id = ?").get(d);
  let signOut = false;
  if (row?.pending_signout) { signOut = true; await identityDb.prepare("UPDATE dist_pwa SET pending_signout = 0 WHERE device_id = ?").run(d); }
  return { status: row?.status || "active", signOut: signOut || row?.status === "killed", kill: row?.status === "killed", reason: row?.kill_reason || undefined };
}
export { J };