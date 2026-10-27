// Company page registry: validated creation, owner edits, soft delete and
// restore, private supporting documents, domain-ownership verification and
// the dispute (defamation/fake-page) process. Routes own auth and rate
// limits; this module owns the rules.
import crypto from "node:crypto";
import { contentDb } from "./db.js";
import { getCompanyById, normalizeCompanyName, eraseCompany } from "./service.js";
import { COMPANY_TERMS_VERSION, COMPANY_DECLARATIONS, COMPANY_LIMITS, COMPANY_SIZES, COMPANY_RELATIONSHIPS, DOCUMENT_TYPES } from "../company-terms.js";
import { uploadPrivateObject, deletePrivateObject } from "../storage.js";

export class CompanyError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); this.code = code; this.status = status; this.extra = extra; }
}

const DAY = 864e5;
const now = () => new Date().toISOString();
const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

// Names people use to pose as someone else, or that say nothing.
const RESERVED = /^(linkedout|linkedin|google|apple|microsoft|amazon|meta|facebook|admin|official|support|test|asdf|company|none|n\/?a)$/i;

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } }
function safeWebsite(input) {
  let v = clean(input, 200);
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(u.hostname)) return null;
    return u.origin + (u.pathname === "/" ? "" : u.pathname);
  } catch { return null; }
}

export function validateCompanyInput(b, { partial = false } = {}) {
  const out = {};
  const errors = {};
  const need = (key, val, msg) => { if (!partial && !val) errors[key] = msg; };

  if (!partial || b.name !== undefined) {
    out.name = clean(b.name, 80);
    if (!out.name || out.name.length < 2) errors.name = "Enter the company's name (at least 2 characters).";
    else if (RESERVED.test(out.name)) errors.name = "That name can't be used for a company page.";
  }
  if (!partial || b.legalName !== undefined) { out.legalName = clean(b.legalName, 140); need("legalName", out.legalName, "Enter the registered legal name."); }
  if (!partial || b.industry !== undefined) { out.industry = clean(b.industry, 60); need("industry", out.industry, "Choose an industry."); }
  if (!partial || b.description !== undefined) {
    out.description = clean(b.description, 1200);
    if (!partial && out.description.length < 60) errors.description = "Describe what the company does in at least 60 characters.";
    if (partial && out.description && out.description.length < 60) errors.description = "Description must be at least 60 characters.";
  }
  if (!partial || b.website !== undefined) {
    out.website = safeWebsite(b.website);
    if (!out.website) errors.website = "Enter the company's real website (e.g. https://acme.com).";
  }
  if (!partial || b.headquarters !== undefined) out.headquarters = clean(b.headquarters, 80) || null;
  if (!partial || b.sizeRange !== undefined) {
    out.sizeRange = COMPANY_SIZES.includes(b.sizeRange) ? b.sizeRange : null;
    need("sizeRange", out.sizeRange, "Choose the company size.");
  }
  if (!partial || b.foundedYear !== undefined) {
    const y = Number(b.foundedYear);
    out.foundedYear = Number.isInteger(y) && y >= 1800 && y <= new Date().getFullYear() ? y : null;
    need("foundedYear", out.foundedYear, "Enter a valid founding year.");
  }
  if (!partial || b.registrationCountry !== undefined) {
    out.registrationCountry = clean(b.registrationCountry, 60);
    need("registrationCountry", out.registrationCountry, "Enter the country of registration.");
  }
  if (!partial || b.registrationNumber !== undefined) {
    out.registrationNumber = clean(b.registrationNumber, 60);
    if (!partial && out.registrationNumber.length < 4) errors.registrationNumber = "Enter the company registration / tax number.";
  }
  if (!partial || b.relationship !== undefined) {
    out.relationship = COMPANY_RELATIONSHIPS.some((r) => r.key === b.relationship) ? b.relationship : null;
    need("relationship", out.relationship, "Tell us your relationship to the company.");
  }
  if (!partial || b.contactEmail !== undefined) {
    const e = clean(b.contactEmail, 120).toLowerCase();
    out.contactEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
    if (!partial && !out.contactEmail) errors.contactEmail = "Enter a contact email (ideally at the company's own domain).";
  }
  if (Object.keys(errors).length) throw new CompanyError("VALIDATION", "Please fix the highlighted fields.", 400, { fields: errors });
  return out;
}

export function validateDeclarations(decl, confirmName, name) {
  const missing = COMPANY_DECLARATIONS.filter((d) => !decl || decl[d.key] !== true);
  if (missing.length) throw new CompanyError("DECLARATIONS", "You must tick every declaration to continue.", 400);
  if (clean(confirmName, 80).toLowerCase() !== name.toLowerCase()) throw new CompanyError("CONFIRM_NAME", "Type the company name exactly to confirm.", 400);
}

async function audit(companyId, actor, action, detail) {
  await contentDb.prepare("INSERT INTO company_audit (id, company_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), companyId, actor, action, detail ? JSON.stringify(detail) : null, now());
}

async function ownedRow(id, ownerKey, { allowDeleted = false } = {}) {
  const row = await contentDb.prepare("SELECT * FROM companies WHERE id = ?").get(id);
  if (!row) throw new CompanyError("NOT_FOUND", "Company not found.", 404);
  if (row.owner_key !== ownerKey) throw new CompanyError("NOT_OWNER", "Only the page owner can do that.", 403);
  if (row.status === "deleted" && !allowDeleted) throw new CompanyError("DELETED", "This page is deleted. Restore it first.", 410);
  if (row.status === "suspended") throw new CompanyError("SUSPENDED", "This page has been suspended. Contact support to appeal.", 403);
  return row;
}

export async function activePageCount(ownerKey) {
  return Number((await contentDb.prepare("SELECT COUNT(*) AS n FROM companies WHERE owner_key = ? AND status = 'active'").get(ownerKey)).n);
}

export async function createRegisteredCompany({ input, ownerKey, authorDisplay, tier }) {
  const cap = COMPANY_LIMITS.pagesByTier[tier] ?? 1;
  if ((await activePageCount(ownerKey)) >= cap) {
    throw new CompanyError("PAGE_LIMIT", `Your plan allows ${cap} company page${cap === 1 ? "" : "s"}.${tier === "pro" ? "" : " Upgrade for more, or delete one you no longer need."}`, 403);
  }
  const norm = normalizeCompanyName(input.name);
  // One live page per company name + country — stops copycats and accidental duplicates.
  const dupe = await contentDb.prepare(
    "SELECT id FROM companies WHERE name_norm = ? AND lower(COALESCE(registration_country,'')) = lower(?) AND status IN ('active','suspended')"
  ).get(norm, input.registrationCountry);
  if (dupe) throw new CompanyError("DUPLICATE", "A page for this company already exists. Open it and use “Report” if it's wrong or fake.", 409, { existingId: dupe.id });
  const dupeReg = input.registrationNumber && await contentDb.prepare(
    "SELECT id FROM companies WHERE lower(registration_number) = lower(?) AND lower(COALESCE(registration_country,'')) = lower(?) AND status IN ('active','suspended')"
  ).get(input.registrationNumber, input.registrationCountry);
  if (dupeReg) throw new CompanyError("DUPLICATE", "A page using this registration number already exists.", 409, { existingId: dupeReg.id });

  const id = crypto.randomUUID();
  const t = now();
  await contentDb.prepare(
    `INSERT INTO companies (id, name, industry, description, created_by_anonymous_id, created_by_display, created_at,
       owner_key, legal_name, name_norm, registration_country, registration_number, website, headquarters, size_range,
       founded_year, relationship, contact_email, status, verification, terms_version, terms_accepted_at, updated_at, name_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'unverified', ?, ?, ?, ?)`
  ).run(id, input.name, input.industry, input.description, ownerKey, authorDisplay, t, ownerKey, input.legalName, norm,
    input.registrationCountry, input.registrationNumber, input.website, input.headquarters, input.sizeRange,
    input.foundedYear, input.relationship, input.contactEmail, COMPANY_TERMS_VERSION, t, t, t);
  await audit(id, ownerKey, "created", { termsVersion: COMPANY_TERMS_VERSION, relationship: input.relationship });
  return getCompanyById(id, ownerKey);
}

export async function updateRegisteredCompany({ id, ownerKey, changes }) {
  const row = await ownedRow(id, ownerKey);
  const map = {
    name: "name", legalName: "legal_name", industry: "industry", description: "description", website: "website",
    headquarters: "headquarters", sizeRange: "size_range", foundedYear: "founded_year",
    registrationCountry: "registration_country", registrationNumber: "registration_number",
    relationship: "relationship", contactEmail: "contact_email",
  };
  const sets = [], vals = [], diff = {};
  for (const [k, col] of Object.entries(map)) {
    if (changes[k] === undefined) continue;
    const cur = row[col];
    if (String(cur ?? "") === String(changes[k] ?? "")) continue;
    if (k === "name") {
      if (row.name_changed_at && Date.now() - new Date(row.name_changed_at).getTime() < COMPANY_LIMITS.renameEveryDays * DAY && row.name !== changes.name) {
        const when = new Date(new Date(row.name_changed_at).getTime() + COMPANY_LIMITS.renameEveryDays * DAY);
        throw new CompanyError("RENAME_COOLDOWN", `The name can be changed once every ${COMPANY_LIMITS.renameEveryDays} days. Next change: ${when.toLocaleDateString("en-GB")}.`, 429);
      }
      sets.push("name_norm = ?", "name_changed_at = ?"); vals.push(normalizeCompanyName(changes.name), now());
    }
    sets.push(`${col} = ?`); vals.push(changes[k]);
    diff[k] = { from: cur ?? null, to: changes[k] ?? null };
  }
  // Changing identity-defining details invalidates earlier trust signals.
  const identityChanged = ["name", "legalName", "registrationNumber", "registrationCountry", "website"].some((k) => diff[k]);
  if (identityChanged) {
    sets.push("verification = CASE WHEN verification = 'verified' THEN 'submitted' ELSE verification END");
    if (diff.website) sets.push("domain_verified = 0");
  }
  if (sets.length === 0) return getCompanyById(id, ownerKey);
  sets.push("updated_at = ?"); vals.push(now());
  await contentDb.prepare(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  await audit(id, ownerKey, "edited", diff);
  return getCompanyById(id, ownerKey);
}

export async function softDeleteCompany({ id, ownerKey }) {
  await ownedRow(id, ownerKey);
  await contentDb.prepare("UPDATE companies SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
  await audit(id, ownerKey, "deleted", null);
  return { deleted: true, restorableForDays: COMPANY_LIMITS.restoreWindowDays };
}

export async function restoreCompany({ id, ownerKey, tier }) {
  const row = await ownedRow(id, ownerKey, { allowDeleted: true });
  if (row.status !== "deleted") return getCompanyById(id, ownerKey);
  if (Date.now() - new Date(row.deleted_at).getTime() > COMPANY_LIMITS.restoreWindowDays * DAY) throw new CompanyError("EXPIRED", "The restore window has passed.", 410);
  const cap = COMPANY_LIMITS.pagesByTier[tier] ?? 1;
  if ((await activePageCount(ownerKey)) >= cap) throw new CompanyError("PAGE_LIMIT", `Your plan allows ${cap} active page${cap === 1 ? "" : "s"}.`, 403);
  await contentDb.prepare("UPDATE companies SET status = 'active', deleted_at = NULL, updated_at = ? WHERE id = ?").run(now(), id);
  await audit(id, ownerKey, "restored", null);
  return getCompanyById(id, ownerKey);
}

// Owner may permanently erase a page right now (skipping the 30-day window).
export async function eraseNow({ id, ownerKey }) {
  const row = await ownedRow(id, ownerKey, { allowDeleted: true });
  if (row.status !== "deleted") throw new CompanyError("NOT_DELETED", "Delete the page first, then you can erase it permanently.", 409);
  const open = await contentDb.prepare("SELECT 1 AS x FROM company_disputes WHERE company_id = ? AND status = 'open'").get(id);
  if (open) throw new CompanyError("DISPUTE_OPEN", "There is an open report on this page, so it must be kept until that is resolved.", 409);
  await eraseCompany(id);
  return { erased: true };
}

// ---- Documents (private bucket; owner sees metadata, reviewers get signed URLs) ----
const DOC_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_DOC = 10 * 1024 * 1024;

export async function addDocument({ id, ownerKey, docType, file }) {
  const row = await ownedRow(id, ownerKey);
  if (!DOCUMENT_TYPES.some((d) => d.key === docType)) throw new CompanyError("BAD_TYPE", "Choose what kind of document this is.");
  const ext = DOC_TYPES[file?.type];
  if (!ext) throw new CompanyError("BAD_FILE", "Upload a PDF or a PNG/JPEG/WebP image.");
  if (file.size > MAX_DOC) throw new CompanyError("TOO_LARGE", "Files can be up to 10MB.");
  const count = Number((await contentDb.prepare("SELECT COUNT(*) AS n FROM company_documents WHERE company_id = ?").get(id)).n);
  if (count >= COMPANY_LIMITS.maxDocs) throw new CompanyError("DOC_LIMIT", `You can attach up to ${COMPANY_LIMITS.maxDocs} documents.`);

  const docId = crypto.randomUUID();
  const key = `company-docs/${id}/${docId}.${ext}`;
  await uploadPrivateObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  await contentDb.prepare(
    "INSERT INTO company_documents (id, company_id, doc_type, file_key, filename, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(docId, id, docType, key, clean(file.name || "document", 120), file.type, file.size, now());
  // Documents in hand = ready for human review.
  if (row.verification === "unverified" || row.verification === "rejected") {
    await contentDb.prepare("UPDATE companies SET verification = 'submitted', verification_note = NULL, updated_at = ? WHERE id = ?").run(now(), id);
  }
  await audit(id, ownerKey, "document_added", { docType });
  return getCompanyById(id, ownerKey);
}

export async function removeDocument({ id, ownerKey, documentId }) {
  await ownedRow(id, ownerKey);
  const doc = await contentDb.prepare("SELECT * FROM company_documents WHERE id = ? AND company_id = ?").get(documentId, id);
  if (!doc) throw new CompanyError("NOT_FOUND", "Document not found.", 404);
  await deletePrivateObject(doc.file_key).catch(() => {});
  await contentDb.prepare("DELETE FROM company_documents WHERE id = ?").run(documentId);
  const left = Number((await contentDb.prepare("SELECT COUNT(*) AS n FROM company_documents WHERE company_id = ?").get(id)).n);
  if (left === 0) await contentDb.prepare("UPDATE companies SET verification = CASE WHEN verification = 'submitted' THEN 'unverified' ELSE verification END WHERE id = ?").run(id);
  await audit(id, ownerKey, "document_removed", { docType: doc.doc_type });
  return getCompanyById(id, ownerKey);
}

// ---- Domain ownership: prove you control an address at the company's website ----
const DOMAIN_CODE_TTL = 15 * 60 * 1000;
const hashCode = (id, code) => crypto.createHmac("sha256", process.env.IDENTITY_SIGNING_SECRET || "dev-only-pepper").update(`dom:${id}:${code}`).digest("hex");

export async function startDomainVerification({ id, ownerKey, email }) {
  const row = await ownedRow(id, ownerKey);
  const host = hostOf(row.website);
  const target = clean(email || row.contact_email, 120).toLowerCase();
  if (!host) throw new CompanyError("NO_WEBSITE", "Add the company's website first.");
  const domain = target.split("@")[1] || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || !(domain === host || domain.endsWith("." + host))) {
    throw new CompanyError("DOMAIN_MISMATCH", `Use an email address at ${host} (e.g. you@${host}).`);
  }
  const code = String(crypto.randomInt(100000, 1000000));
  await contentDb.prepare(
    `INSERT INTO company_domain_codes (company_id, email, code_hash, attempts, created_at, expires_at) VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT (company_id) DO UPDATE SET email = EXCLUDED.email, code_hash = EXCLUDED.code_hash, attempts = 0, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`
  ).run(id, target, hashCode(id, code), now(), new Date(Date.now() + DOMAIN_CODE_TTL).toISOString());
  return { email: target, code, expiresInMin: DOMAIN_CODE_TTL / 60000 };
}

export async function confirmDomainVerification({ id, ownerKey, code }) {
  const row = await ownedRow(id, ownerKey);
  const rec = await contentDb.prepare("SELECT * FROM company_domain_codes WHERE company_id = ?").get(id);
  if (!rec || new Date(rec.expires_at) < new Date()) {
    if (rec) await contentDb.prepare("DELETE FROM company_domain_codes WHERE company_id = ?").run(id);
    throw new CompanyError("EXPIRED", "That code expired. Request a new one.");
  }
  const a = Buffer.from(hashCode(id, String(code || "").trim()), "hex"), b = Buffer.from(rec.code_hash, "hex");
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
    if (rec.attempts + 1 >= 5) { await contentDb.prepare("DELETE FROM company_domain_codes WHERE company_id = ?").run(id); throw new CompanyError("TOO_MANY", "Too many wrong codes. Request a new one.", 429); }
    await contentDb.prepare("UPDATE company_domain_codes SET attempts = attempts + 1 WHERE company_id = ?").run(id);
    throw new CompanyError("WRONG_CODE", "Incorrect code.");
  }
  await contentDb.prepare("DELETE FROM company_domain_codes WHERE company_id = ?").run(id);
  await contentDb.prepare("UPDATE companies SET domain_verified = 1, contact_email = ?, updated_at = ? WHERE id = ?").run(rec.email, now(), id);
  await audit(id, ownerKey, "domain_verified", { domain: rec.email.split("@")[1] });
  return getCompanyById(id, ownerKey);
}

// ---- Disputes: anyone can report a fake page or false, damaging content ----
export const DISPUTE_REASONS = {
  fake_page: "This company page is fake or impersonates a company",
  false_statement: "A review or story contains false, damaging statements",
  harassment: "Content targets or names an individual",
  confidential: "Content exposes confidential information",
  other: "Something else",
};

export async function fileDispute({ companyId, reporterKey, targetType, targetId, reason, details }) {
  const c = await contentDb.prepare("SELECT id, owner_key FROM companies WHERE id = ? AND status != 'deleted'").get(companyId);
  if (!c) throw new CompanyError("NOT_FOUND", "Company not found.", 404);
  if (!DISPUTE_REASONS[reason]) throw new CompanyError("BAD_REASON", "Choose a reason.");
  if (!["company", "review", "story"].includes(targetType)) throw new CompanyError("BAD_TARGET", "Invalid report target.");
  const text = clean(details, 1500);
  if (text.length < 20) throw new CompanyError("DETAILS", "Explain the problem in at least 20 characters so a reviewer can act on it.");
  const dupe = await contentDb.prepare(
    "SELECT 1 AS x FROM company_disputes WHERE company_id = ? AND reporter_key = ? AND COALESCE(target_id,'') = COALESCE(?, '') AND status = 'open'"
  ).get(companyId, reporterKey, targetId || null);
  if (dupe) throw new CompanyError("ALREADY", "You already have an open report on this.", 409);
  const id = crypto.randomUUID();
  await contentDb.prepare(
    "INSERT INTO company_disputes (id, company_id, target_type, target_id, reporter_key, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)"
  ).run(id, companyId, targetType, targetId || null, reporterKey, reason, text, now());
  await audit(companyId, null, "dispute_filed", { targetType, reason });
  return { id, ownerKey: c.owner_key };
}
