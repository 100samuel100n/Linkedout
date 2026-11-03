// SCIM 2.0 Users for company representatives. SCIM can attach an EXISTING LinkedOut account (matched by email) as a representative
// and detach them. It never creates a LinkedOut account, never sets a password, never sees anything the person has written.
import { contentDb } from "../content/db.js";
import { identityDb, storiesIdentityReady } from "../stories/identity-db.js";
import { getOrCreateAlias } from "../identity/service.js";
import { repHandle, repKeyByHandle, planOf, auditCompany } from "../stories/business.js";
import { ASSIGNABLE_ROLES } from "../company-roles.js";
import { SEATS } from "../business-features.js";

const E = (m, s = 400) => Object.assign(new Error(m), { status: s });
const SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const asUser = (companyId, handle, role, active = true) => ({ schemas: [SCHEMA], id: handle, userName: handle, active, roles: [{ value: role, primary: true }], meta: { resourceType: "User" } });
export async function scimList(companyId) {
  const reps = await contentDb.prepare("SELECT anon_key, role FROM company_reps WHERE company_id = ?").all(companyId);
  const res = reps.map((r) => asUser(companyId, repHandle(companyId, r.anon_key), r.role === "responder" ? "communications" : r.role));
  return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: res.length, startIndex: 1, itemsPerPage: res.length, Resources: res };
}
export async function scimGet(companyId, handle) { const t = await repKeyByHandle(companyId, handle); if (!t) throw E("Not found", 404); return asUser(companyId, handle, t.role); }
export async function scimCreate(companyId, body) {
  const email = String((body.emails || []).find((e) => e.primary)?.value || body.emails?.[0]?.value || body.userName || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw E("A work email is required (emails[0].value or userName).");
  await storiesIdentityReady(); const acct = await identityDb.prepare("SELECT id FROM accounts WHERE lower(email) = ?").get(email);
  if (!acct) throw E("No LinkedOut account uses that email. The person must sign up first; SCIM never creates accounts.", 409);
  const role = ASSIGNABLE_ROLES.includes(body.roles?.[0]?.value) ? body.roles[0].value : "communications";
  const key = (await getOrCreateAlias(acct.id)).anonymousId, p = await planOf(companyId);
  const c = await contentDb.prepare("SELECT owner_key FROM companies WHERE id = ?").get(companyId); if (c.owner_key === key) throw E("That person is the owner.", 409);
  const seats = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_reps WHERE company_id = ?").get(companyId)).n) + 1; const had = await contentDb.prepare("SELECT 1 x FROM company_reps WHERE company_id = ? AND anon_key = ?").get(companyId, key);
  if (!had && seats >= (SEATS[p.plan] || 1)) throw E(`The plan allows ${SEATS[p.plan]} representatives.`, 403);
  await contentDb.prepare("INSERT INTO company_reps (company_id, anon_key, role, created_at) VALUES (?,?,?,?) ON CONFLICT (company_id, anon_key) DO UPDATE SET role = EXCLUDED.role").run(companyId, key, role, new Date().toISOString());
  await auditCompany(companyId, null, "scim_provisioned", repHandle(companyId, key)); return asUser(companyId, repHandle(companyId, key), role);
}
export async function scimPatch(companyId, handle, body) {
  const t = await repKeyByHandle(companyId, handle); if (!t) throw E("Not found", 404); if (t.role === "owner") throw E("The owner can't be changed by SCIM.", 403);
  const ops = body.Operations || [body]; let active = true, role = null;
  for (const o of ops) { const path = String(o.path || "").toLowerCase(), v = o.value; if (path === "active" || (v && typeof v === "object" && "active" in v)) active = (v && typeof v === "object" ? v.active : v) !== false && String(v?.active ?? v) !== "false"; if (path === "roles" || v?.roles) { const r = (Array.isArray(v) ? v[0]?.value : v?.roles?.[0]?.value) || null; if (ASSIGNABLE_ROLES.includes(r)) role = r; } }
  if (!active) { await contentDb.prepare("DELETE FROM company_reps WHERE company_id = ? AND anon_key = ?").run(companyId, t.key); await auditCompany(companyId, null, "scim_deprovisioned", handle); return asUser(companyId, handle, t.role, false); }
  if (role) await contentDb.prepare("UPDATE company_reps SET role = ? WHERE company_id = ? AND anon_key = ?").run(role, companyId, t.key);
  return asUser(companyId, handle, role || t.role);
}
export async function scimDelete(companyId, handle) { const t = await repKeyByHandle(companyId, handle); if (!t) throw E("Not found", 404); if (t.role === "owner") throw E("The owner can't be removed by SCIM.", 403); await contentDb.prepare("DELETE FROM company_reps WHERE company_id = ? AND anon_key = ?").run(companyId, t.key); await auditCompany(companyId, null, "scim_deprovisioned", handle); }
