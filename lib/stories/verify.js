// Employment verification. Goal: a "Verified current/former employee" badge that is earned,
// not claimed, without LinkedOut ever learning more than it needs to.
//
//   work_email  you prove control of an address at the company's domain (6-digit code).
//               We store the DOMAIN only, never the address, and the employer is never told.
//   document    you upload a payslip/contract/ID card. A reviewer approves or rejects it and the
//               file is DELETED as soon as a decision is made.
//
// A verification belongs to the ACCOUNT (identity store). The badge reaches Stories through the
// account's aliases: it is stamped on new stories at write time and on existing ones when approved.
// Nothing in the content store can be joined back to the account.
import crypto from "node:crypto";
import { storiesIdentityReady, identityDb } from "./identity-db.js";
import { contentDb } from "../content/db.js";
import { getAnonymousIdsForAccount, createNotification } from "../identity/service.js";
import { sendEmploymentCodeEmail } from "../email.js";
import { uploadPrivateObject, deletePrivateObject, getPrivateSignedUrl } from "../storage.js";
import { normCompany, StoryError } from "./service.js";

const nowIso = () => new Date().toISOString();
const TTL = 15 * 60 * 1000;
const VALID_MS = 365 * 864e5;
const pepper = () => process.env.IDENTITY_SIGNING_SECRET || "dev-only-pepper";
const hash = (id, code) => crypto.createHmac("sha256", pepper()).update(`emp:${id}:${code}`).digest("hex");
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "aol.com", "live.com", "msn.com", "yandex.com", "gmx.com", "zoho.com", "mail.com"]);
const hostOf = (w) => { try { return new URL(/^https?:/.test(w) ? w : `https://${w}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

async function companyFor({ companyId, companyName }) {
  const c = companyId ? await contentDb.prepare("SELECT id, name, website FROM companies WHERE id = ? AND status='active'").get(companyId)
    : await contentDb.prepare("SELECT id, name, website FROM companies WHERE name_norm = ? AND status='active'").get(normCompany(companyName));
  return c || null;
}

export async function startWorkEmail(accountId, { companyId, companyName, email, kind }) {
  await storiesIdentityReady();
  const c = await companyFor({ companyId, companyName });
  if (!c) throw new StoryError("Find the company page first. If it doesn't exist yet, register it, or use the document option.", 404, "NO_COMPANY");
  const host = hostOf(c.website || "");
  const addr = String(email || "").trim().toLowerCase();
  const domain = addr.split("@")[1] || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new StoryError("Enter your work email address.");
  if (FREE_MAIL.has(domain)) throw new StoryError("Use your work address (not a personal inbox). If you don't have one, use the document option.", 400, "PERSONAL_EMAIL");
  // With a website on the company page we can match the domain automatically. Without one we can't, so the
  // person still proves they control a work address (code below) and then a reviewer confirms the domain
  // belongs to this company; nothing is auto-approved on an unverifiable domain.
  const needsReview = !host;
  if (host && !(domain === host || domain.endsWith("." + host))) throw new StoryError(`That address isn't at ${host}. Use your ${host} address, or the document option.`, 400, "DOMAIN_MISMATCH");
  const open = Number((await identityDb.prepare("SELECT COUNT(*) n FROM employment_verifications WHERE account_id = ? AND status = 'pending' AND created_at > ?").get(accountId, new Date(Date.now() - 864e5).toISOString())).n);
  if (open >= 5) throw new StoryError("Too many open attempts today. Try again tomorrow.", 429, "RATE");
  const id = crypto.randomUUID(); const code = String(crypto.randomInt(100000, 1000000));
  await identityDb.prepare(`INSERT INTO employment_verifications (id, account_id, company_key, company_name, company_id, kind, method, email_domain, code_hash, code_expires_at, status, created_at)
    VALUES (?,?,?,?,?,?, 'work_email', ?,?,?, 'pending', ?)`)
    .run(id, accountId, normCompany(c.name), c.name, c.id, kind === "former" ? "former" : "current", domain, hash(id, code), new Date(Date.now() + TTL).toISOString(), nowIso());
  if (needsReview) await identityDb.prepare("UPDATE employment_verifications SET note = 'review_domain' WHERE id = ?").run(id);
  await sendEmploymentCodeEmail(addr, code, c.name, TTL / 60000);
  return { id, domain, expiresInMin: TTL / 60000 };
}

export async function confirmWorkEmail(accountId, { id, code }) {
  await storiesIdentityReady();
  const v = await identityDb.prepare("SELECT * FROM employment_verifications WHERE id = ? AND account_id = ? AND method = 'work_email' AND status = 'pending'").get(id, accountId);
  if (!v) throw new StoryError("Start a new verification.", 404, "NOT_FOUND");
  if (new Date(v.code_expires_at) < new Date()) { await identityDb.prepare("UPDATE employment_verifications SET status = 'expired', code_hash = NULL WHERE id = ?").run(id); throw new StoryError("That code expired. Request a new one.", 400, "EXPIRED"); }
  const a = Buffer.from(hash(id, String(code || "").trim()), "hex"), b = Buffer.from(v.code_hash, "hex");
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    if (v.attempts + 1 >= 5) { await identityDb.prepare("UPDATE employment_verifications SET status = 'expired', code_hash = NULL WHERE id = ?").run(id); throw new StoryError("Too many wrong codes. Start again.", 429, "TOO_MANY"); }
    await identityDb.prepare("UPDATE employment_verifications SET attempts = attempts + 1 WHERE id = ?").run(id);
    throw new StoryError("Incorrect code.", 400, "WRONG_CODE");
  }
  if (v.note === "review_domain") {
    // Code accepted (they control the address) but the company has no website to match against: staff confirm the domain.
    await identityDb.prepare("UPDATE employment_verifications SET code_hash = NULL, note = 'review_domain:confirmed_address' WHERE id = ?").run(id);
    return { verified: false, pendingReview: true, message: "Your work address is confirmed. A reviewer will match its domain to the company, usually within a day." };
  }
  await approve(v, "work email");
  return { verified: true };
}

export async function submitDocument(accountId, { companyId, companyName, kind, file }) {
  await storiesIdentityReady();
  const c = await companyFor({ companyId, companyName });
  const name = c?.name || String(companyName || "").trim().slice(0, 120);
  if (!name) throw new StoryError("Tell us which company.");
  if (!file || file.size > 8 * 1024 * 1024) throw new StoryError("Attach a PDF or image up to 8 MB.");
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new StoryError("Attach a PDF, PNG, JPG or WebP.");
  const id = crypto.randomUUID(); const key = `employment-docs/${id}`;
  await uploadPrivateObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await identityDb.prepare(`INSERT INTO employment_verifications (id, account_id, company_key, company_name, company_id, kind, method, document_path, status, created_at)
    VALUES (?,?,?,?,?,?, 'document', ?, 'pending', ?)`).run(id, accountId, normCompany(name), name, c?.id || null, kind === "former" ? "former" : "current", key, nowIso());
  return { id, status: "pending" };
}

async function approve(v, by) {
  const exp = new Date(Date.now() + VALID_MS).toISOString();
  await identityDb.prepare("UPDATE employment_verifications SET status = 'verified', verified_at = ?, expires_at = ?, reviewed_by = ?, code_hash = NULL WHERE id = ?").run(nowIso(), exp, by, v.id);
  const keys = await getAnonymousIdsForAccount(v.account_id);
  if (keys.length) {
    const ph = keys.map(() => "?").join(",");
    await contentDb.prepare(`UPDATE stories SET verified_employment = 1, employment_claim = ? WHERE company_key = ? AND anonymous_id IN (${ph})`).run(v.kind, v.company_key, ...keys);
  }
  await createNotification(v.account_id, "verification", `You're now a verified ${v.kind} employee of ${v.company_name}. Your stories about them carry the badge.`).catch(() => {});
}

// Staff review of document submissions. The file is deleted once a decision is made.
export async function reviewDocument(id, decision, staffName, note) {
  await storiesIdentityReady();
  const v = await identityDb.prepare("SELECT * FROM employment_verifications WHERE id = ? AND status = 'pending' AND (method = 'document' OR note = 'review_domain:confirmed_address')").get(id);
  if (!v) throw new StoryError("Not found or already decided.", 404, "NOT_FOUND");
  if (decision === "approved") await approve(v, staffName);
  else {
    await identityDb.prepare("UPDATE employment_verifications SET status = 'rejected', reviewed_by = ?, note = ? WHERE id = ?").run(staffName, String(note || "").slice(0, 300), id);
    await createNotification(v.account_id, "verification", `We couldn't verify your employment at ${v.company_name}. ${note ? "Reason: " + String(note).slice(0, 200) : "You can try again with a clearer document."}`).catch(() => {});
  }
  if (v.document_path) { await deletePrivateObject(v.document_path).catch(() => {}); await identityDb.prepare("UPDATE employment_verifications SET document_path = NULL WHERE id = ?").run(id); }
}
export async function documentUrl(id) {
  await storiesIdentityReady();
  const v = await identityDb.prepare("SELECT document_path FROM employment_verifications WHERE id = ?").get(id);
  if (!v?.document_path) throw new StoryError("No document attached.");
  return getPrivateSignedUrl(v.document_path, 600);
}

export async function myVerifications(accountId) {
  await storiesIdentityReady();
  const rows = await identityDb.prepare("SELECT id, company_name, company_id, kind, method, status, note, verified_at, expires_at, created_at FROM employment_verifications WHERE account_id = ? AND status <> 'expired' ORDER BY created_at DESC").all(accountId);
  return rows.map((r) => ({ ...r, status: r.status === "verified" && r.expires_at < nowIso() ? "expired" : r.status }));
}
export async function endVerification(accountId, id, newKind) {
  await storiesIdentityReady();
  const v = await identityDb.prepare("SELECT * FROM employment_verifications WHERE id = ? AND account_id = ? AND status = 'verified'").get(id, accountId);
  if (!v) throw new StoryError("Not found.", 404, "NOT_FOUND");
  // "I left": the badge changes from current to former (the verification stays valid as history).
  await identityDb.prepare("UPDATE employment_verifications SET kind = ? WHERE id = ?").run(newKind === "former" ? "former" : "current", id);
  const keys = await getAnonymousIdsForAccount(accountId);
  if (keys.length) await contentDb.prepare(`UPDATE stories SET employment_claim = ? WHERE company_key = ? AND verified_employment = 1 AND anonymous_id IN (${keys.map(() => "?").join(",")})`).run(newKind === "former" ? "former" : "current", v.company_key, ...keys);
  return { ok: true };
}
// company_key -> 'current' | 'former' for the account's live verifications (used when a Story is written).
export async function verifiedMap(accountId) {
  await storiesIdentityReady();
  const rows = await identityDb.prepare("SELECT company_key, kind FROM employment_verifications WHERE account_id = ? AND status = 'verified' AND expires_at > ?").all(accountId, nowIso());
  return Object.fromEntries(rows.map((r) => [r.company_key, r.kind]));
}
