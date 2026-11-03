// What an admin can see about an install: who (linked account name + email), the exact IP, approximate location from the network,
// and, only if the person agreed on their device, precise GPS. Stored encrypted (AES-256-GCM via lib/security/vault.js) so a plain database
// read does not reveal IPs or coordinates; decrypted only inside the admin console for staff with distribution.read.
//
// PRIVACY: location and IP are personal data (GDPR, Kenya Data Protection Act 2019, etc.). Precise GPS is NEVER collected silently: the app and
// the web app ask in their own consent card first, and the OS permission prompt follows. Disclose this in the privacy policy. Admin can switch
// collection off entirely (policy: collect_details = 0), and installs older than the retention window have their IP/location cleared by purgeOldDetails().
import { encryptField, decryptField } from "@/lib/security/vault";
import { identityDb } from "@/lib/identity/db";
import { settings, distReady, now, J, P } from "./db.js";

const dec = (v) => { try { return decodeURIComponent(v); } catch { return v; } };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// City-level data some hosts add to every request (Cloudflare "Add visitor location headers", Vercel). Fly adds only the IP.
export function geoFromHeaders(h) {
  const g = (k) => h.get(k) || "";
  const city = dec(g("cf-ipcity") || g("x-vercel-ip-city")), region = dec(g("cf-region") || g("x-vercel-ip-country-region")),
    country = (g("cf-ipcountry") || g("x-vercel-ip-country")).toUpperCase().replace("XX", ""),
    lat = num(g("cf-iplatitude") || g("x-vercel-ip-latitude")), lon = num(g("cf-iplongitude") || g("x-vercel-ip-longitude")),
    tz = g("cf-timezone") || g("x-vercel-ip-timezone");
  const out = { city, region, country, lat, lon, tz, source: city || lat != null ? "edge" : "country-only" };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== "" && v !== null));
}

// Optional lookup for hosts that give only an IP. Off unless GEOIP_PROVIDER is set, because it sends the IP to that provider.
//   GEOIP_PROVIDER=ipinfo + GEOIP_TOKEN=...   (https://ipinfo.io)   or   GEOIP_PROVIDER=ipapi  (https://ip-api.com, server-side use only on a paid plan for HTTPS)
const geoCache = new Map();
export async function lookupGeo(ip) {
  const p = (process.env.GEOIP_PROVIDER || "").toLowerCase(); if (!p || !ip) return null;
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const ctl = AbortSignal.timeout(2500); let out = null;
    if (p === "ipinfo") { const j = await (await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(process.env.GEOIP_TOKEN || "")}`, { signal: ctl })).json(); const [lat, lon] = String(j.loc || ",").split(",").map(num); out = { city: j.city, region: j.region, country: j.country, lat, lon, tz: j.timezone, isp: j.org, source: "ipinfo" }; }
    else if (p === "ipapi") { const j = await (await fetch(`https://pro.ip-api.com/json/${encodeURIComponent(ip)}?key=${encodeURIComponent(process.env.GEOIP_TOKEN || "")}&fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp,as`, { signal: ctl })).json(); if (j.status === "success") out = { city: j.city, region: j.regionName, country: j.countryCode, lat: j.lat, lon: j.lon, tz: j.timezone, isp: j.isp, asn: j.as, source: "ip-api" }; }
    if (out) out = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if (geoCache.size > 2000) geoCache.clear(); geoCache.set(ip, out); return out;
  } catch { return null; }
}

// Returns { ip_enc, geo } to store, or {} when collection is switched off.
export async function buildDetails(headers, ip) {
  const s = await settings(); if (s.collect_details !== "1" || !ip) return {};
  let geo = geoFromHeaders(headers);
  if (!geo.city && !geo.lat) { const looked = await lookupGeo(ip); if (looked) geo = { ...geo, ...looked }; }
  return { ip_enc: encryptField(ip), geo: J(geo) };
}

// Precise GPS the person agreed to share (consent flag is stored with it). Coordinates are rounded to 5 decimals (~1 m).
export function cleanPrecise(p) {
  if (!p || p.consent !== true) return null;
  const lat = num(p.lat), lon = num(p.lon), acc = num(p.accuracy);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return J({ lat: +lat.toFixed(5), lon: +lon.toFixed(5), accuracy: acc === null ? null : Math.round(acc), at: now(), consent: true });
}
export const ipOf = (enc) => { try { return enc ? decryptField(enc) : ""; } catch { return ""; } };
export const preciseOf = (raw) => P(raw, null);
export const geoOf = (raw) => P(raw, {});
export const mapsLink = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;
export const placeText = (geo, precise) => { const bits = [geo?.city, geo?.region, geo?.country].filter(Boolean).join(", "); return precise ? `${precise.lat}, ${precise.lon}${precise.accuracy ? ` (±${precise.accuracy} m)` : ""}${bits ? " · " + bits : ""}` : bits || "unknown"; };

// Retention: clear IP and location from records not seen for `days` days (default 180). Run from the daily maintenance / admin action.
export async function purgeOldDetails(days = 180) {
  await distReady(); const cut = new Date(Date.now() - days * 864e5).toISOString();
  const a = await identityDb.prepare("UPDATE dist_installs SET ip_enc = NULL, geo = NULL, precise = NULL WHERE last_seen < ? AND (ip_enc IS NOT NULL OR geo IS NOT NULL OR precise IS NOT NULL)").run(cut);
  const b = await identityDb.prepare("UPDATE dist_pwa SET ip_enc = NULL, geo = NULL, precise = NULL WHERE last_seen < ? AND (ip_enc IS NOT NULL OR geo IS NOT NULL OR precise IS NOT NULL)").run(cut);
  return (a.changes || 0) + (b.changes || 0);
}
