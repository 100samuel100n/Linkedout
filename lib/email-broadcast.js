// Branded broadcast email: template, plain-text/markdown-lite formatter, and
// Resend delivery (batched, rate-limited, with one-click unsubscribe headers).
// Table-based + inline-styled on purpose — that is what renders consistently in
// Outlook / Gmail / Apple Mail. Light card design (not the in-app dark theme)
// because dark-mode HTML email support is uneven across clients.
import { getAppUrl } from "./config.js";
import { signToken } from "./identity/crypto.js";

const BRAND = { navy: "#0C1423", blue: "#4C61FF", text: "#1A2233", muted: "#6B7280", border: "#E5E8EF", bg: "#F4F6FB", soft: "#EEF1FF" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return ["http:", "https:", "mailto:"].includes(x.protocol) ? x.toString() : null; } catch { return null; } };

// ---- body formatting ---------------------------------------------------------
// Plain text with light formatting:  blank line = new paragraph · "## Heading" ·
// "- item" bullets · **bold** · [link text](https://…) · {{firstName}} {{handle}}
export function formatBody(text, vars = {}) {
  const sub = (s) => s.replace(/\{\{\s*(firstName|handle)\s*\}\}/g, (_, k) => esc(vars[k] ?? (k === "firstName" ? "there" : "")));
  const inline = (raw) => sub(esc(raw))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => { const u = safeUrl(href.replace(/&amp;/g, "&")); return u ? `<a href="${esc(u)}" style="color:${BRAND.blue};text-decoration:underline;">${label}</a>` : label; });
  return String(text || "").replace(/\r/g, "").trim().split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (/^##\s+/.test(block)) return `<h2 style="margin:26px 0 8px;font-size:17px;line-height:1.3;color:${BRAND.text};">${inline(block.replace(/^##\s+/, ""))}</h2>`;
    if (lines.every((l) => /^[-•]\s+/.test(l))) return `<ul style="margin:0 0 16px;padding-left:20px;">${lines.map((l) => `<li style="margin:0 0 6px;">${inline(l.replace(/^[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    return `<p style="margin:0 0 16px;">${lines.map(inline).join("<br>")}</p>`;
  }).join("\n");
}
export function toPlainText(text, vars = {}) {
  return String(text || "").replace(/\r/g, "").replace(/\{\{\s*firstName\s*\}\}/g, vars.firstName || "there").replace(/\{\{\s*handle\s*\}\}/g, vars.handle || "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)").replace(/^##\s+/gm, "").trim();
}

export function unsubscribeUrl(accountId) {
  const t = signToken({ t: "unsub", a: accountId, exp: Date.now() + 400 * 864e5 });
  return `${getAppUrl()}/api/email/unsubscribe?t=${encodeURIComponent(t)}`;
}

// ---- template ----------------------------------------------------------------
export function renderBroadcastEmail({ headline, body, ctaLabel, ctaUrl, preheader = "", kind = "marketing", unsubUrl = null, vars = {}, isTest = false }) {
  const app = getAppUrl(), logo = `${app}/logo-mark.png`;
  const url = ctaUrl && safeUrl(ctaUrl.startsWith("/") ? app + ctaUrl : ctaUrl);
  const service = kind === "service";
  const address = process.env.EMAIL_FOOTER_ADDRESS || "";
  const cta = url && ctaLabel ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;"><tr><td style="border-radius:10px;background:${BRAND.blue};"><a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">${esc(ctaLabel)}</a></td></tr></table>` : "";
  const footer = service
    ? `You're receiving this because it's an important service message about your Linkedout account.`
    : `You're receiving this because you have a Linkedout account and opted in to announcements and offers.`;
  const links = service ? `<a href="${app}/settings" style="color:${BRAND.muted};text-decoration:underline;">Account settings</a>`
    : `${unsubUrl ? `<a href="${esc(unsubUrl)}" style="color:${BRAND.muted};text-decoration:underline;">Unsubscribe</a> &nbsp;·&nbsp; ` : ""}<a href="${app}/settings#notifications" style="color:${BRAND.muted};text-decoration:underline;">Email preferences</a>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><meta name="color-scheme" content="light"/><title>${esc(headline || "Linkedout")}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:28px 14px;"><tr><td align="center">
  ${isTest ? `<div style="max-width:560px;margin:0 0 10px;padding:8px 12px;background:#FFF4D6;border:1px solid #F2D58A;border-radius:8px;font-size:12px;color:#7A5B00;">TEST SEND — this is how your broadcast will look. It was sent only to you.</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border};">
    <tr><td style="background:${BRAND.navy};padding:22px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;"><img src="${logo}" width="30" height="30" alt="" style="display:block;border-radius:7px;"/></td>
        <td style="vertical-align:middle;padding-left:10px;font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:-0.2px;">Linked<span style="color:${BRAND.blue};">Out</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;background:${BRAND.blue};line-height:4px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="padding:36px 32px 12px;color:${BRAND.text};font-size:15px;line-height:1.65;">
      ${headline ? `<h1 style="margin:0 0 18px;font-size:26px;line-height:1.25;font-weight:800;color:${BRAND.text};letter-spacing:-0.3px;">${esc(headline)}</h1>` : ""}
      ${formatBody(body, vars)}
      ${cta}
      <p style="margin:6px 0 28px;color:${BRAND.muted};font-size:14px;">— The Linkedout team</p>
    </td></tr>
    <tr><td style="padding:22px 32px;background:${BRAND.bg};border-top:1px solid ${BRAND.border};">
      <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${BRAND.muted};">${footer}</p>
      <p style="margin:0 0 8px;font-size:12px;color:${BRAND.muted};">${links}</p>
      ${address ? `<p style="margin:0;font-size:11.5px;color:#9AA1B2;">${esc(address)}</p>` : ""}
    </td></tr>
  </table>
  <p style="max-width:560px;margin:14px 0 0;font-size:11.5px;color:#9AA1B2;text-align:center;">Linkedout</p>
</td></tr></table></body></html>`;
}
export function renderPlain({ headline, body, ctaLabel, ctaUrl, unsubUrl, kind, vars }) {
  const app = getAppUrl();
  return [headline, "", toPlainText(body, vars), ctaUrl && ctaLabel ? `\n${ctaLabel}: ${ctaUrl.startsWith("/") ? app + ctaUrl : ctaUrl}` : "", "\n— The Linkedout team", "", kind === "service" ? "This is a service message about your Linkedout account." : `Unsubscribe: ${unsubUrl || app + "/settings#notifications"}`].filter((x) => x !== null).join("\n");
}

// ---- delivery (Resend REST, batched) ----------------------------------------------
const API = "https://api.resend.com";
import { senderFor, emailConfigured } from "./email-senders.js";
// Service notices (outages, maintenance) and marketing (news, offers) go out from different identities.
const from = (kind) => senderFor(kind === "service" ? "service" : "news").from;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(path, body, extraHeaders = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
    if (res.status === 429 || res.status >= 500) { await wait(1200 * (attempt + 1)); continue; }
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  }
  return { ok: false, status: 429, json: {} };
}
export const isResendConfigured = () => emailConfigured();

export function buildMessage(rcpt, b) {
  const unsubUrl = b.kind === "service" ? null : unsubscribeUrl(rcpt.id);
  const vars = { firstName: (rcpt.real_name || rcpt.pseudonym || "").trim().split(/\s+/)[0] || "there", handle: rcpt.pseudonym || "" };
  const args = { headline: b.title, body: b.body, ctaLabel: b.cta_label, ctaUrl: b.cta_url, preheader: b.preheader || "", kind: b.kind, unsubUrl, vars };
  return {
    from: from(b.kind), to: [rcpt.email], subject: b.subject.replace(/\{\{\s*firstName\s*\}\}/g, vars.firstName),
    html: renderBroadcastEmail(args), text: renderPlain(args),
    ...(process.env.RESEND_REPLY_TO ? { reply_to: process.env.RESEND_REPLY_TO } : {}),
    ...(unsubUrl ? { headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
  };
}

// Sends up to 100 per request; if a batch is rejected as a whole (one bad address),
// falls back to one-by-one for that batch so a single bad row can't sink the rest.
export async function sendBatch(messages) {
  if (!isResendConfigured()) return { sent: 0, failed: messages.length, error: "Resend isn't configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." };
  const r = await call("/emails/batch", messages);
  if (r.ok) return { sent: messages.length, failed: 0 };
  let sent = 0, failed = 0, error = r.json?.message || null;
  for (const m of messages) { const one = await call("/emails", m); if (one.ok) sent++; else { failed++; error = one.json?.message || error; } await wait(550); }
  return { sent, failed, error };
}
export async function sendOne(message) {
  if (!isResendConfigured()) return { ok: false, error: "Resend isn't configured (RESEND_API_KEY / RESEND_FROM_EMAIL)." };
  const r = await call("/emails", message);
  return { ok: r.ok, error: r.ok ? null : r.json?.message || `Resend error ${r.status}` };
}
export const BATCH_PAUSE_MS = 650; // stays under Resend's default 2 requests/second
