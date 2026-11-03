import { identityDb } from "../identity/db.js";
import { bypassesGates } from "./roles.js";

// Roles holding `gates.bypass` (super_admin, admin) skip the verification
// requirements, plan/tier limits and rate limits — so staff can exercise every
// feature while testing a prototype before launch. Cached 10 s per account so
// hot paths (likes, reactions) don't pay an extra query on every tap.
const cache = new Map();
export async function bypassesGatesFor(accountId) {
  const hit = cache.get(accountId);
  if (hit && hit.until > Date.now()) return hit.v;
  const r = await identityDb.prepare("SELECT role FROM accounts WHERE id = ?").get(accountId);
  const v = bypassesGates(r?.role);
  cache.set(accountId, { v, until: Date.now() + 10000 });
  if (cache.size > 2000) cache.clear();
  return v;
}
