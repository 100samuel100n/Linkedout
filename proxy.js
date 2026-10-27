// Runs before matched requests (Next.js 16 "proxy"). Three jobs:
//  1. /sitemap.xml is for search engines only (see below).
//  2. Perimeter defence: WAF rules, attack-tool user agents, IP/country blocklist, tarpit and throttle, honeytoken
//     detection. Rules that need the database (blocklist, honeytokens) are fetched from /api/internal/blocklist
//     every 15 s and cached here, so the proxy itself never touches the database.
//  3. Reports hits to /api/internal/waf-report so they appear as alerts in Security Operations.
// Fails open: if the blocklist can't be fetched, traffic is NOT blocked (an outage here must never take the site down).
import { NextResponse } from "next/server";
import { wafInspect } from "@/lib/security/waf";
import { internalKey } from "@/lib/security/internal-key";

const CRAWLERS = /(googlebot|google-inspectiontool|storebot-google|adsbot-google|bingbot|bingpreview|msnbot|duckduckbot|yandex(bot)?|baiduspider|applebot|slurp|seznambot|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|discordbot|petalbot|ahrefsbot|semrushbot)/i;

let cache = { at: 0, data: { rules: [], tokens: [], allow: [], killSwitch: false } }, fetching = null;
const hits = new Map(); // ip -> [count, windowStart] for "throttle" rules
const burst = new Map(); // ip -> [count, windowStart] global per-IP flood limit (DDoS last line of defence)

async function refresh(origin) {
  if (fetching) return fetching;
  fetching = fetch(`${origin}/api/internal/blocklist`, { headers: { "x-sec-key": internalKey() }, cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) cache = { at: Date.now(), data: d }; })
    .catch(() => { cache.at = Date.now() - 5000; }).finally(() => { fetching = null; });
  return fetching;
}
const ipOf = (h) => (h.get("fly-client-ip") || h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "").trim();
const report = (origin, body) => { fetch(`${origin}/api/internal/waf-report`, { method: "POST", headers: { "x-sec-key": internalKey(), "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => {}); };
const deny = (status, msg) => new NextResponse(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function proxy(request) {
  const url = request.nextUrl, path = url.pathname, h = request.headers;
  const ua = h.get("user-agent") || "";

  if (path === "/sitemap.xml") {
    if (process.env.SITEMAP_PUBLIC === "true" || CRAWLERS.test(ua)) return NextResponse.next();
    return new NextResponse("Not found", { status: 404, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  if (path.startsWith("/api/internal/")) return NextResponse.next();
  if (process.env.SECURITY_PROXY === "off") return NextResponse.next();

  const origin = url.origin, ip = ipOf(h), country = (h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || "").toUpperCase();
  if (Date.now() - cache.at > 15000) { if (cache.at === 0) await refresh(origin); else refresh(origin); }
  const { rules, tokens, allow, attackMode } = cache.data;
  const trusted = ip && allow.includes(ip);

  // Flood limit per IP across all routes. Normal use is far below this; "under attack" mode tightens it and
  // rejects requests with no user agent. Real volumetric DDoS must be absorbed upstream (see docs/SECURITY-OPERATIONS.md).
  if (!trusted && ip) {
    const now = Date.now(), limit = attackMode ? 80 : 600, e = burst.get(ip);
    if (!e || now - e[1] > 10000) burst.set(ip, [1, now]);
    else if (++e[0] > limit) { report(origin, { kind: "waf", ip, rule: "flood", label: "Request flood from one IP", path, ua }); return new NextResponse(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "30" } }); }
    if (burst.size > 20000) burst.clear();
    if (attackMode && !ua) return deny(403, "Request blocked.");
  }

  // Honeytoken presented anywhere in the URL or common credential headers: decoys nobody legitimate holds.
  if (!trusted && tokens.length) {
    const hay = `${url.search} ${h.get("authorization") || ""} ${h.get("x-api-key") || ""} ${h.get("cookie") || ""}`;
    const t = tokens.find((x) => x.length > 8 && hay.includes(x));
    if (t) { report(origin, { kind: "honeytoken", ip, path }); return deny(401, "Invalid credentials."); }
  }
  if (!trusted) {
    for (const r of rules) {
      const match = (r.kind === "ip" && r.value === ip) || (r.kind === "country" && country && r.value === country);
      if (!match) continue;
      if (r.effect === "block") return deny(403, "Access from your network is restricted.");
      if (r.effect === "tarpit") await new Promise((res) => setTimeout(res, 4000));
      if (r.effect === "throttle") {
        const now = Date.now(), e = hits.get(ip);
        if (!e || now - e[1] > 60000) hits.set(ip, [1, now]); else { e[0]++; if (e[0] > 30) return new NextResponse(JSON.stringify({ error: "Too many requests." }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } }); }
        if (hits.size > 5000) hits.clear();
      }
    }
    const w = wafInspect({ pathname: path, search: url.search, userAgent: ua, referer: h.get("referer") || "" });
    if (w.hit && !(w.rule === "bad_ua" && path.startsWith("/_next/"))) {
      report(origin, { kind: "waf", ip, rule: w.rule, label: w.label, path: path + url.search, ua });
      return deny(403, "Request blocked.");
    }
  }
  return NextResponse.next();
}

// Multipart uploads (voice notes, files, photos, video) skip the proxy entirely: Next buffers request bodies that pass
// through the proxy and cuts them off at 10 MB, which would break large uploads. Those routes are authenticated and
// rate-limited on their own, and the proxy never inspected request bodies anyway.
export const config = { matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff2?|ttf|mp3|mp4|webm)$).*)", missing: [{ type: "header", key: "content-type", value: "multipart/form-data.*" }] }] };
