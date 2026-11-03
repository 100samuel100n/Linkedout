// Transactional email via Resend. Same pattern as lib/stripe.js: lazy
// client construction so a missing RESEND_API_KEY doesn't break the build
// or crash a route — it just logs instead of sending, so signup/reset
// flows keep working end to end during local dev without real credentials.
import { Resend } from "resend";
import { getAppUrl } from "./config.js";
import { senderFor, categoryFromLabel, emailConfigured } from "./email-senders.js";
import { NOTIFICATION_CATEGORIES, categoryForType } from "./identity/notification-categories.js";

let _resend = null;

function getResend() {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

export function isEmailConfigured() {
  return emailConfigured();
}

async function send({ to, subject, html, text, logLabel, category }) {
  const resend = getResend();
  if (!resend) {
    // No RESEND_API_KEY: report it plainly rather than pretend it went out.
    console.error(`[email] RESEND_API_KEY is not set — "${logLabel}" was not sent.`);
    return { sent: false, reason: "RESEND_NOT_CONFIGURED" };
  }
  try {
    const s = senderFor(category || categoryFromLabel(logLabel));
    await resend.emails.send({ from: s.from, to, subject, html, text, ...(s.replyTo ? { replyTo: s.replyTo } : {}), ...(s.headers ? { headers: s.headers } : {}) });
    return { sent: true };
  } catch (e) {
    console.error(`[email] failed to send "${logLabel}" to ${to}:`, e.message);
    return { sent: false, reason: e.message };
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------
// Shared branded layout. Table-based and inline-styled throughout —
// not because it's 2003, but because that's still what actually renders
// consistently across Outlook/Gmail/Apple Mail. A light card design
// (not the app's own dark theme) is deliberate: dark-mode HTML email
// support is inconsistent across clients, and a white card with a navy
// accent bar reads as more "production-grade transactional email" than
// trying to force the in-app dark palette into an inbox.
// ---------------------------------------------------------------
const BRAND = {
  navy: "#0C1423",
  navy2: "#16223B",
  blue: "#4C61FF",
  text: "#1A2233",
  muted: "#667085",
  border: "#E4E7EE",
  bg: "#F2F4F9",
  soft: "#F6F8FD",
  amber: "#B7791F",
  amberBg: "#FFF8E6",
  green: "#1E7F4F",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function button(label, href, { secondary = false } = {}) {
  const bg = secondary ? "#FFFFFF" : BRAND.blue, color = secondary ? BRAND.blue : "#FFFFFF", border = secondary ? `1px solid ${BRAND.blue}` : `1px solid ${BRAND.blue}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 26px 0 8px;"><tr><td style="border-radius: 10px; background: ${bg}; border: ${border};">
    <a href="${href}" style="display: inline-block; padding: 13px 28px; font-family: ${FONT}; font-size: 14px; font-weight: 700; color: ${color}; text-decoration: none; border-radius: 10px;">${label}</a>
  </td></tr></table>`;
}

// Title block: small coloured eyebrow, big heading, one-line lead.
function heading(title, lead = "", eyebrow = "") {
  return `${eyebrow ? `<p style="margin: 0 0 8px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: ${BRAND.blue};">${escapeHtml(eyebrow)}</p>` : ""}
    <h1 style="margin: 0 0 8px; font-size: 24px; line-height: 1.25; font-weight: 800; color: ${BRAND.text}; letter-spacing: -0.01em;">${title}</h1>
    ${lead ? `<p style="margin: 0 0 18px; font-size: 15px; line-height: 1.6; color: ${BRAND.muted};">${lead}</p>` : ""}`;
}

// A tidy label/value table (for "what happened" details).
function details(rows) {
  const tr = rows.filter(([, v]) => v).map(([k, v], i) => `<tr><td style="padding: 10px 14px; font-size: 12.5px; color: ${BRAND.muted}; width: 38%; ${i ? `border-top: 1px solid ${BRAND.border};` : ""}">${escapeHtml(k)}</td><td style="padding: 10px 14px; font-size: 13.5px; font-weight: 600; color: ${BRAND.text}; ${i ? `border-top: 1px solid ${BRAND.border};` : ""}">${escapeHtml(v)}</td></tr>`).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 18px 0; background: ${BRAND.soft}; border: 1px solid ${BRAND.border}; border-radius: 10px;">${tr}</table>`;
}

function callout(html, tone = "info") {
  const c = tone === "warn" ? { bg: BRAND.amberBg, bd: "#F2D9A0", fg: BRAND.amber } : { bg: BRAND.soft, bd: BRAND.border, fg: BRAND.muted };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 18px 0 0;"><tr><td style="background: ${c.bg}; border: 1px solid ${c.bd}; border-radius: 10px; padding: 12px 14px; font-size: 12.5px; line-height: 1.55; color: ${c.fg};">${html}</td></tr></table>`;
}

function steps(items) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 14px 0 0;">${items.map(([t, d], i) => `<tr><td style="vertical-align: top; width: 34px; padding: 6px 0;"><div style="width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 12px; background: ${BRAND.blue}; color: #fff; font-size: 12px; font-weight: 700;">${i + 1}</div></td><td style="padding: 6px 0 10px; font-size: 14px; line-height: 1.5; color: ${BRAND.text};"><b>${escapeHtml(t)}</b><br /><span style="color: ${BRAND.muted}; font-size: 13px;">${escapeHtml(d)}</span></td></tr>`).join("")}</table>`;
}

function layout({ preheader = "", body, footerNote = "" }) {
  const logoUrl = `${getAppUrl()}/logo-mark.png`;
  const prefsLink = `${getAppUrl()}/settings#notifications`;
  const helpLink = `${getAppUrl()}/help`;
  const year = new Date().getUTCFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>Linkedout</title>
</head>
<body style="margin: 0; padding: 0; background: ${BRAND.bg}; font-family: ${FONT};">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${BRAND.bg}; padding: 36px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width: 560px;" cellpadding="0" cellspacing="0">
        <tr><td style="padding: 0 4px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align: middle;"><img src="${logoUrl}" width="28" height="28" alt="" style="display: block; border-radius: 7px;" /></td>
            <td style="vertical-align: middle; padding-left: 9px; font-size: 18px; font-weight: 800; color: ${BRAND.navy}; letter-spacing: -0.02em;">Linkedout</td>
          </tr></table>
        </td></tr>
        <tr><td style="background: #FFFFFF; border-radius: 16px; border: 1px solid ${BRAND.border}; overflow: hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height: 5px; background: ${BRAND.blue}; background-image: linear-gradient(90deg, ${BRAND.navy}, ${BRAND.blue}); font-size: 0; line-height: 0;">&nbsp;</td></tr>
            <tr><td style="padding: 36px 34px 32px; color: ${BRAND.text}; font-size: 14px; line-height: 1.6;">
              ${body}
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding: 22px 8px 0; text-align: center;">
          <p style="margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: ${BRAND.muted};">${footerNote}</p>
          <p style="margin: 0 0 8px; font-size: 12px; color: ${BRAND.muted};">
            <a href="${prefsLink}" style="color: ${BRAND.muted}; text-decoration: underline;">Notification preferences</a>
            &nbsp;&middot;&nbsp;
            <a href="${helpLink}" style="color: ${BRAND.muted}; text-decoration: underline;">Help &amp; support</a>
          </p>
          <p style="margin: 0; font-size: 11.5px; color: #98A2B3;">&copy; ${year} Linkedout. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const NOW = () => new Date().toUTCString().replace("GMT", "UTC");

export function sendWelcomeEmail(to, realName) {
  const first = String(realName || "").trim().split(/\s+/)[0] || "there";
  const body = `
    ${heading(`Welcome, ${escapeHtml(first)}.`, "Your Linkedout account is ready. Here is how to get going in a couple of minutes.", "Welcome")}
    ${steps([
      ["Pick how you appear", "Post under a pseudonym, as yourself, or fully anonymous. You can change this per post."],
      ["Say what actually happened", "Rants, confessions, polls and honest company reviews. No humble-bragging required."],
      ["Join a Vent Room", "Live audio rooms for the conversations the feed can't hold."],
    ])}
    ${button("Open Linkedout", getAppUrl())}
    ${callout("Tip: visit <b>Settings</b> any time to change your pseudonym, avatar, notification and privacy preferences.")}
  `;
  return send({
    to, subject: "Welcome to Linkedout", logLabel: "welcome",
    html: layout({ preheader: "Your account is ready. Here is how to get started.", body, footerNote: "You're receiving this because you just created a Linkedout account." }),
    text: `Welcome to Linkedout, ${realName}. Open the app: ${getAppUrl()}`,
  });
}

export function sendVerificationEmail(to, token) {
  const link = `${getAppUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  const body = `
    ${heading("Confirm your email address", "One quick step to finish setting up your account and keep it secure.", "Verification")}
    ${button("Verify email address", link)}
    <p style="margin: 14px 0 0; font-size: 12.5px; color: ${BRAND.muted};">Button not working? Copy and paste this link into your browser:<br /><span style="word-break: break-all; color: ${BRAND.blue};">${link}</span></p>
    ${callout("This link expires in <b>24 hours</b>. If you didn't sign up for Linkedout, you can safely ignore this email.")}
  `;
  return send({
    to, subject: "Verify your Linkedout email", logLabel: "email verification",
    html: layout({ preheader: "Confirm your email address to finish setting up.", body, footerNote: "You're receiving this because this email address was used to sign up for Linkedout." }),
    text: `Verify your email (expires in 24 hours): ${link}`,
  });
}

export function sendPasswordResetEmail(to, token) {
  const link = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const body = `
    ${heading("Reset your password", "We received a request to reset the password for your Linkedout account.", "Account security")}
    ${details([["Requested", NOW()], ["Account", to]])}
    ${button("Choose a new password", link)}
    ${callout("This link expires in <b>1 hour</b> and can be used once. If you didn't request this, ignore this email: your password won't change unless you click the link and choose a new one. If this keeps happening, change your password from Settings and turn on two-factor authentication.", "warn")}
  `;
  return send({
    to, subject: "Reset your Linkedout password", logLabel: "password reset",
    html: layout({ preheader: "Use this link to choose a new password. It expires in 1 hour.", body, footerNote: "You're receiving this because a password reset was requested for this account." }),
    text: `Reset your password (expires in 1 hour): ${link}\nIf you didn't request this, ignore this email.`,
  });
}

const NOTIFICATION_SUBJECTS = {
  reaction: "Someone reacted to your post",
  comment: "New comment on your post",
  repost: "Someone reposted your post",
  poll_vote: "New activity on your poll",
  mention: "You were mentioned in a post",
  follow: "You have a new follower",
  room_joined: "Someone joined your Vent Room",
  room_promoted: "You can speak in the room now",
  room_muted: "Your mic was muted",
  badge: "You earned a new badge",
  verification: "Update on your verification request",
  security: "Security alert for your account",
};

// Fired from createNotification() in lib/identity/service.js, which has
// already checked this category's email preference before calling here —
// this function itself doesn't re-check preferences, it just sends.
export function sendNotificationEmail(to, type, message, relatedPostId) {
  const link = relatedPostId ? `${getAppUrl()}/post/${relatedPostId}` : `${getAppUrl()}/profile`;
  const category = categoryForType(type);
  const categoryLabel = NOTIFICATION_CATEGORIES[category]?.label || "Notifications";
  const subject = NOTIFICATION_SUBJECTS[type] || "New Linkedout notification";
  const security = type === "security";
  const body = `
    ${heading(escapeHtml(subject), "", categoryLabel)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 6px 0 4px;"><tr><td style="background: ${BRAND.soft}; border: 1px solid ${BRAND.border}; border-left: 4px solid ${security ? BRAND.amber : BRAND.blue}; border-radius: 10px; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: ${BRAND.text};">${escapeHtml(message)}</td></tr></table>
    <p style="margin: 10px 0 0; font-size: 12px; color: ${BRAND.muted};">${NOW()}</p>
    ${button(security ? "Review account activity" : "View on Linkedout", link)}
    ${security ? callout("If this wasn't you, change your password right away from Settings and turn on two-factor authentication.", "warn") : ""}
  `;
  return send({
    to, subject, logLabel: `notification:${type}`,
    html: layout({ preheader: message, body, footerNote: `You're receiving this because your "${categoryLabel}" email notifications are on. You can turn them off any time.` }),
    text: `${message}\n${link}`,
  });
}

export function sendCompanyDomainCodeEmail(to, code, minutes = 15) {
  return send({
    to,
    subject: "Verify your company domain on Linkedout",
    logLabel: "company-domain-code",
    text: `Your Linkedout company verification code is ${code}. It expires in ${minutes} minutes. If you didn't request this, ignore this email.`,
    html: layout({
      preheader: `Your verification code is ${code}`,
      body: `${heading("Verify your company domain", "Enter this code on Linkedout to prove you control this address.", "Company verification")}
        <div style="font-size: 34px; letter-spacing: 10px; font-weight: 800; color: ${BRAND.navy}; background: ${BRAND.soft}; border: 1px dashed ${BRAND.blue}; border-radius: 12px; padding: 18px 20px; text-align: center; font-family: 'SF Mono', Menlo, Consolas, monospace;">${escapeHtml(code)}</div>
        ${details([["Valid for", `${minutes} minutes`], ["Sent to", to]])}
        ${callout("Never share this code. Linkedout staff will never ask for it. If you didn't request it, you can ignore this email.", "warn")}`,
      footerNote: "You're receiving this because someone started company verification with this email address.",
    }),
  });
}

export function sendEmploymentCodeEmail(to, code, companyName, minutes = 15) {
  return send({
    to,
    subject: `Verify you work at ${companyName} on Linkedout`,
    logLabel: "employment-code",
    text: `Your Linkedout employment verification code is ${code}. It expires in ${minutes} minutes. We only use this to confirm your address belongs to ${companyName}; the address is not stored or shown. If you didn't request this, ignore this email.`,
    html: layout({
      preheader: `Your verification code is ${code}`,
      body: `${heading("Verify your employment", `Enter this code to confirm you have an address at ${escapeHtml(companyName)}.`, "Employment verification")}
        <div style="font-size: 34px; letter-spacing: 10px; font-weight: 800; color: ${BRAND.navy}; background: ${BRAND.soft}; border: 1px dashed ${BRAND.blue}; border-radius: 12px; padding: 18px 20px; text-align: center; font-family: 'SF Mono', Menlo, Consolas, monospace;">${escapeHtml(code)}</div>
        ${details([["Valid for", `${minutes} minutes`]])}
        ${callout("We keep only the domain of this address, never the address itself, and your employer is never told. Never share this code.", "warn")}`,
      footerNote: "You're receiving this because someone started employment verification with this email address.",
    }),
  });
}

export function sendAccountActionCodeEmail(to, code, purpose, minutes = 10) {
  const label = purpose === "delete" ? "delete your account" : "deactivate your account";
  const title = purpose === "delete" ? "Confirm account deletion" : "Confirm account deactivation";
  return send({
    to,
    subject: `${title} on Linkedout`,
    logLabel: `account-${purpose}-code`,
    text: `Your Linkedout confirmation code is ${code}. Enter it to ${label}. It expires in ${minutes} minutes. If this wasn't you, don't share the code and change your password right away.`,
    html: layout({
      preheader: `Your confirmation code is ${code}`,
      body: `${heading(title, `Enter this code in Linkedout to ${label}.`, "Security check")}
        <div style="font-size: 34px; letter-spacing: 10px; font-weight: 800; color: ${BRAND.navy}; background: ${BRAND.soft}; border: 1px dashed ${BRAND.blue}; border-radius: 12px; padding: 18px 20px; text-align: center; font-family: 'SF Mono', Menlo, Consolas, monospace;">${escapeHtml(code)}</div>
        ${details([["Valid for", `${minutes} minutes`], ["Sent to", to]])}
        ${callout("If you didn't ask for this, someone may be using your account. Don't share this code, and change your password right away.", "warn")}`,
      footerNote: "You're receiving this because a deactivation or deletion was requested on your Linkedout account.",
    }),
  });
}

export function sendSupportReceivedEmail(to, name, ref, subject) {
  return send({
    to,
    subject: `We got your message (${ref})`,
    logLabel: "support-received",
    text: `Hi${name ? " " + name : ""}, we've received your message "${subject}". Your reference is ${ref}. We reply by email, usually within two working days.`,
    html: layout({
      preheader: `Your reference is ${ref}`,
      body: `${heading("We got your message", "Thanks for getting in touch. A real person will read it and reply by email.", "Support")}
        ${details([["Reference", ref], ["Subject", subject], ["Reply time", "Usually within two working days"]])}
        ${callout("For your safety, we never ask for your password or a verification code by email.", "warn")}`,
      footerNote: "You're receiving this because this address was used on the Linkedout contact form.",
    }),
  });
}

export function sendSupportReplyEmail(to, ref, subject, message) {
  return send({
    to,
    subject: `Re: ${subject} (${ref})`,
    logLabel: "support-reply",
    text: `${message}\n\n— Linkedout Support\nReference ${ref}. Reply to this email to continue the conversation.`,
    html: layout({
      preheader: String(message).slice(0, 90),
      body: `${heading(`Re: ${escapeHtml(subject)}`, "A reply from the Linkedout team.", "Support")}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 6px 0 4px;"><tr><td style="background: ${BRAND.soft}; border: 1px solid ${BRAND.border}; border-left: 4px solid ${BRAND.blue}; border-radius: 10px; padding: 16px 18px; font-size: 15px; line-height: 1.55; color: ${BRAND.text}; white-space: pre-wrap;">${escapeHtml(message)}</td></tr></table>
        ${details([["Reference", ref]])}`,
      footerNote: "Reply to this email to continue the conversation.",
    }),
  });
}

// Goes to the team inbox (SUPPORT_INBOX_EMAIL) so nobody has to watch the admin queue to notice a message.
export function sendSupportInboxAlert(ref, { name, email, category, subject, body }) {
  const to = process.env.SUPPORT_INBOX_EMAIL;
  if (!to) return Promise.resolve({ sent: false, reason: "SUPPORT_INBOX_EMAIL_NOT_SET" });
  return send({
    to,
    subject: `[${ref}] ${subject}`,
    logLabel: "support-inbox-alert",
    text: `${name || "Someone"} <${email}> · ${category}\n\n${body}`,
    html: layout({
      preheader: `${category}: ${subject}`,
      body: `${heading(escapeHtml(subject), "New message from the contact form.", "Support inbox")}
        ${details([["Reference", ref], ["From", `${name || "—"} <${email}>`], ["Category", category]])}
        <div style="font-size: 14px; line-height: 1.55; color: ${BRAND.text}; white-space: pre-wrap; margin-top: 8px;">${escapeHtml(body)}</div>`,
      footerNote: "Reply from the admin dashboard so the conversation stays on the ticket.",
    }),
  });
}

// ---- Staff and sign-in security ----------------------------------------------------------------
export function sendStaffLoginCodeEmail(to, code, minutes = 10) {
  return send({
    to, subject: `${code} is your LinkedOut admin sign-in code`, logLabel: "staff-login-code",
    text: `Your LinkedOut admin sign-in code is ${code}. It expires in ${minutes} minutes. If you didn't request it, don't share it and tell a super admin.`,
    html: layout({
      preheader: `Your admin sign-in code is ${code}`,
      body: `${heading("Your admin sign-in code", "Enter this code to finish signing in to the admin console.", "Staff security")}
        <div style="font-size: 34px; letter-spacing: 10px; font-weight: 800; color: ${BRAND.navy}; background: ${BRAND.soft}; border: 1px dashed ${BRAND.blue}; border-radius: 12px; padding: 18px 20px; text-align: center;">${escapeHtml(code)}</div>
        ${details([["Valid for", `${minutes} minutes`], ["Sent to", to]])}
        ${callout("If you didn't just try to sign in, someone may know your password. Don't share this code and report it to a super admin.", "warn")}`,
      footerNote: "You're receiving this because a staff sign-in was started on your account.",
    }),
  });
}

export function sendNewSignInEmail(to, { device, country, when }) {
  return send({
    to, subject: "New sign-in to your Linkedout account", logLabel: "new-signin",
    text: `A new device signed in to your Linkedout account${country ? ` (${country})` : ""}. If this was you, no action is needed. If not, change your password now.`,
    html: layout({
      preheader: "A new device signed in to your account.",
      body: `${heading("New sign-in to your account", "We noticed a sign-in from a device we haven't seen before.", "Account security")}
        ${details([["When", when || NOW()], ["Device", device ? escapeHtml(device) : ""], ["Region", country || ""]])}
        ${button("Review account activity", `${getAppUrl()}/settings`)}
        ${callout("If this wasn't you, change your password right away from Settings and turn on two-factor authentication.", "warn")}`,
      footerNote: "You're receiving this security notice because sign-in alerts are on for your account.",
    }),
  });
}

// ---- Billing ----------------------------------------------------------------------------------
export function sendReceiptEmail(to, { plan, amount, period, ref }) {
  return send({
    to, subject: `Your Linkedout receipt${plan ? `: ${plan}` : ""}`, logLabel: "billing-receipt",
    text: `Thanks for your payment${amount ? ` of ${amount}` : ""}${plan ? ` for ${plan}` : ""}. Manage billing: ${getAppUrl()}/settings`,
    html: layout({
      preheader: "Your payment was received.",
      body: `${heading("Payment received", "Thanks. Here are the details for your records.", "Billing")}
        ${details([["Plan", plan ? escapeHtml(plan) : ""], ["Amount", amount ? escapeHtml(amount) : ""], ["Period", period ? escapeHtml(period) : ""], ["Reference", ref ? escapeHtml(ref) : ""]])}
        ${button("Manage billing", `${getAppUrl()}/settings`)}`,
      footerNote: "You're receiving this receipt because a payment was made on your Linkedout account.",
    }),
  });
}
export function sendPaymentFailedEmail(to, { plan }) {
  return send({
    to, subject: "We couldn't process your Linkedout payment", logLabel: "billing-failed",
    text: `Your latest payment${plan ? ` for ${plan}` : ""} didn't go through. Update your payment method: ${getAppUrl()}/settings`,
    html: layout({
      preheader: "Update your payment method to keep your plan.",
      body: `${heading("Your payment didn't go through", "Your plan stays active for now, but we couldn't charge your payment method.", "Billing")}
        ${button("Update payment method", `${getAppUrl()}/settings`)}
        ${callout("If we can't collect payment after a few attempts your plan will return to the free tier.", "warn")}`,
      footerNote: "You're receiving this because a payment on your Linkedout account failed.",
    }),
  });
}

// ---- Support / trust outcomes -----------------------------------------------------------------
export function sendDecisionEmail(to, { kind, decision, note }) {
  const title = kind === "appeal" ? "Your appeal has been reviewed" : "Your verification request was reviewed";
  const ok = /approved|upheld|restored|verified/i.test(decision || "");
  return send({
    to, subject: title, logLabel: kind === "appeal" ? "appeal-decision" : "verification-decision",
    text: `${title}. Decision: ${decision}.${note ? ` ${note}` : ""} Details: ${getAppUrl()}/settings`,
    html: layout({
      preheader: `${title}: ${decision}`,
      body: `${heading(title, "", kind === "appeal" ? "Appeals" : "Verification")}
        ${details([["Decision", escapeHtml(decision || "")]])}
        ${note ? callout(escapeHtml(note), ok ? "info" : "warn") : ""}
        ${button("View details", `${getAppUrl()}/settings`)}`,
      footerNote: "You're receiving this because you submitted a request to Linkedout.",
    }),
  });
}
