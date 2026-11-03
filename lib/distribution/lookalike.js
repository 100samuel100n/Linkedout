// Finds look-alike domains and third-party APK listings, and prepares the reports to send to the host, the registrar and Google.
// Everything is read-only against other people's servers (DNS, one HTTPS GET, RDAP). Nothing is ever reported automatically:
// a person reviews the evidence and sends the report (the AI helper, when enabled, only drafts text).
import dns from "node:dns/promises";
import net from "node:net";
import { identityDb } from "@/lib/identity/db";
import { distReady, officialDomains, uid, now, J, P, bad, settings } from "./db.js";

const TLDS = ["com", "net", "org", "app", "io", "co", "xyz", "info", "site", "online", "download", "club", "top", "live"];
const GLYPH = { l: ["1", "i", "I"], i: ["1", "l"], o: ["0"], a: ["4", "@"], e: ["3"], s: ["5"], m: ["rn"], w: ["vv"], d: ["cl"], u: ["v"] };
const splitDomain = (d) => { const p = d.split("."); return { name: p.slice(0, -1).join("."), tld: p[p.length - 1] }; };

export function candidates(domain, max = 160) {
  const { name, tld } = splitDomain(domain.toLowerCase()); const out = new Set();
  for (let i = 0; i < name.length; i++) {
    out.add(name.slice(0, i) + name.slice(i + 1) + "." + tld);                       // omission
    out.add(name.slice(0, i) + name[i] + name.slice(i) + "." + tld);                 // repetition
    if (i < name.length - 1) out.add(name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2) + "." + tld); // transposition
    for (const g of GLYPH[name[i]] || []) out.add(name.slice(0, i) + g + name.slice(i + 1) + "." + tld);        // homoglyph
    if (i > 2 && i < name.length - 2) out.add(name.slice(0, i) + "-" + name.slice(i) + "." + tld);              // hyphenation
  }
  for (const t of TLDS) out.add(name + "." + t);
  for (const x of ["get", "app", "download", "apk", "official", "my", "the", "login"]) { out.add(`${x}${name}.${tld}`); out.add(`${x}-${name}.${tld}`); out.add(`${name}-${x}.${tld}`); out.add(`${name}${x}.${tld}`); }
  out.delete(domain.toLowerCase());
  return [...out].filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !d.startsWith("-")).slice(0, max);
}

const privateIp = (ip) => net.isIP(ip) === 4 ? /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) : /^(::1|fc|fd|fe80)/i.test(ip);

async function resolveSafe(host) {
  let ips = []; try { ips = await Promise.race([dns.resolve4(host), new Promise((_, r) => setTimeout(() => r(new Error("dns timeout")), 4000))]); } catch { return null; }
  if (!ips?.length || ips.some(privateIp)) return null;
  return ips;
}
// One polite look at a host: does it resolve, and does it look like us (name, APK links, our package, a login form)?
export async function inspectHost(host, { pkg } = {}) {
  const ips = await resolveSafe(host); if (!ips) return null;
  const out = { host, ips, status: null, title: "", signals: [], score: 0 };
  try {
    const r = await fetch(`https://${host}/`, { redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "User-Agent": "LinkedOutIntegrityBot/1.0 (+brand protection; read-only)" } });
    out.status = r.status; const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 300000).toString("utf8");
    out.title = (buf.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim();
    if (/linked\s*out/i.test(buf)) { out.signals.push("uses the LinkedOut name"); out.score += 40; }
    if (/\.apk\b/i.test(buf)) { out.signals.push("links to an APK file"); out.score += 25; }
    if (pkg && buf.includes(pkg)) { out.signals.push("mentions our package name"); out.score += 25; }
    if (/type=["']?password/i.test(buf)) { out.signals.push("has a password form"); out.score += 20; }
    if (/logo-mark|linkedout.*logo/i.test(buf)) { out.signals.push("references our logo asset"); out.score += 10; }
  } catch (e) { out.signals.push("resolves but did not answer over HTTPS"); out.score += 5; }
  out.score = Math.min(100, out.score); return out;
}

async function upsert(row) {
  const ex = await identityDb.prepare("SELECT id, status FROM dist_lookalikes WHERE target = ?").get(row.target);
  if (ex) { await identityDb.prepare("UPDATE dist_lookalikes SET last_checked = ?, similarity = ?, http_status = ?, evidence = ? WHERE id = ?").run(now(), row.similarity, row.http_status, row.evidence, ex.id); return { id: ex.id, created: false }; }
  const id = uid();
  await identityDb.prepare("INSERT INTO dist_lookalikes (id, target, kind, source, status, similarity, http_status, evidence, first_seen, last_checked) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, row.target, row.kind || "domain", row.source, "suspected", row.similarity, row.http_status, row.evidence, now(), now());
  return { id, created: true };
}
const raise = async (a) => (await import("@/lib/security/core")).raiseAlert(a);

export async function scanDomains({ limit = 160 } = {}) {
  await distReady(); const s = await settings(); const mine = await officialDomains(); const found = [];
  const queue = mine.flatMap((d) => candidates(d, limit));
  const run = async () => { for (let d; (d = queue.shift());) { if (mine.includes(d)) continue; const r = await inspectHost(d, { pkg: s.package_name }).catch(() => null); if (!r) continue; if (r.score < 25 && !r.signals.length) continue;
    const u = await upsert({ target: d, source: "typosquat-scan", similarity: r.score, http_status: r.status, evidence: J({ ips: r.ips, title: r.title, signals: r.signals }) });
    if (u.created) { found.push(d); await raise({ type: "lookalike_domain", subject: `lookalike:${d}`, detail: { domain: d, score: r.score, signals: r.signals }, title: `Look-alike domain is live: ${d}`, dedupeMin: 1440 }); } } };
  await Promise.all(Array.from({ length: 8 }, run));
  return found;
}

// Third-party APK listing sites. {q} is replaced with the app name. Adjust the list in DIST_WATCH_SITES (comma-separated URL templates).
const DEFAULT_SITES = ["https://apkpure.com/search?q={q}", "https://en.aptoide.com/search?query={q}", "https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s={q}", "https://en.uptodown.com/android/search/{q}"];
export async function scanApkSites() {
  await distReady(); const s = await settings();
  const sites = (process.env.DIST_WATCH_SITES ? process.env.DIST_WATCH_SITES.split(",") : DEFAULT_SITES).map((x) => x.trim()).filter(Boolean);
  const official = (await identityDb.prepare("SELECT url FROM dist_channels WHERE enabled = 1").all()).map((c) => { try { return new URL(c.url).hostname; } catch { return ""; } });
  const found = [];
  for (const tpl of sites) {
    const url = tpl.replace("{q}", encodeURIComponent("linkedout")); let host = ""; try { host = new URL(url).hostname; } catch { continue; }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { "User-Agent": "LinkedOutIntegrityBot/1.0 (+brand protection; read-only)" } });
      const html = (await r.text()).slice(0, 500000); const hasPkg = html.includes(s.package_name); const hasName = /linked\s*out/i.test(html);
      if (!hasPkg && !hasName) continue;
      const isOfficialHost = official.some((h) => h && (host === h || host.endsWith("." + h.replace(/^www\./, ""))));
      const u = await upsert({ target: url, kind: "apk_site", source: "apk-site-scan", similarity: hasPkg ? 80 : 40, http_status: r.status, evidence: J({ host, mentionsPackage: hasPkg, mentionsName: hasName, onOfficialChannel: isOfficialHost, note: isOfficialHost ? "Listing on a channel we use: confirm the publisher and signing certificate are ours." : "Not a channel we publish to." }) });
      if (u.created && !isOfficialHost) { found.push(url); await raise({ type: "lookalike_domain", subject: `apk:${host}`, detail: { site: host, url, mentionsPackage: hasPkg }, title: `LinkedOut listing found on APK site ${host}`, dedupeMin: 1440 }); }
    } catch { /* site blocked us or is down: skip quietly */ }
  }
  return found;
}
export async function scanAll({ auto = false } = {}) { const d = await scanDomains(); const a = await scanApkSites(); return { domains: d, apkSites: a, auto }; }

// ---------------------------------------------------------------- who to report to
async function rdapGet(url) { try { const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/rdap+json" }, redirect: "follow" }); return r.ok ? await r.json() : null; } catch { return null; } }
const vcard = (e, k) => (e?.vcardArray?.[1] || []).find((x) => x[0] === k)?.[3] || "";
const walk = (e, roles, acc = []) => { for (const x of e || []) { if ((x.roles || []).some((r) => roles.includes(r))) acc.push(x); walk(x.entities, roles, acc); } return acc; };
export async function whoToReport(target) {
  let host = target; try { host = new URL(target.includes("://") ? target : `https://${target}`).hostname; } catch { /* */ }
  const out = { host, registrar: "", registrarAbuse: "", hostOrg: "", hostAbuse: "", nameservers: [], ips: [] };
  const dom = await rdapGet(`https://rdap.org/domain/${host}`);
  if (dom) {
    const reg = walk(dom.entities, ["registrar"])[0]; out.registrar = vcard(reg, "fn");
    out.registrarAbuse = vcard(walk(reg?.entities, ["abuse"])[0], "email") || vcard(walk(dom.entities, ["abuse"])[0], "email");
    out.nameservers = (dom.nameservers || []).map((n) => n.ldhName).filter(Boolean);
  }
  out.ips = (await resolveSafe(host)) || [];
  if (out.ips[0]) { const ip = await rdapGet(`https://rdap.org/ip/${out.ips[0]}`); if (ip) { out.hostOrg = ip.name || vcard(walk(ip.entities, ["registrant"])[0], "fn") || ""; out.hostAbuse = vcard(walk(ip.entities, ["abuse"])[0], "email"); } }
  return out;
}
// Plain, factual text. No accusations beyond what was observed. Edit before sending.
export function reportText(row, who, official) {
  const ev = P(row.evidence, {}); const sig = (ev.signals || []).join("; ") || "see attached evidence";
  return `Subject: Report of a site impersonating LinkedOut (${who.host})\n\nHello,\n\nI am writing on behalf of LinkedOut (${official[0] || "our official site"}). The site ${row.target} appears to present itself as LinkedOut or to distribute a copy of our app without our authorisation.\n\nWhat we observed (${new Date().toISOString().slice(0, 10)}):\n- ${sig}\n- Our only official domains are: ${official.join(", ")}\n- Official downloads are listed in our signed manifest at ${official[0] ? "https://" + official[0] : ""}/.well-known/linkedout-distribution.json\n\nWe ask you to review this site under your abuse/acceptable-use policy and take appropriate action. We can provide further evidence on request.\n\nThank you,\nLinkedOut security team`;
}
export const REPORT_CHANNELS = [
  ["Google Safe Browsing (phishing / malware)", (t) => `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(t)}`],
  ["Microsoft SmartScreen", () => "https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site"],
  ["Cloudflare abuse (if the site is behind Cloudflare)", () => "https://abuse.cloudflare.com/"],
];
