// Short-lived "is this account allowed to hold a session?" cache, shared by lib/session.js (reads it) and
// lib/identity/service.js (clears it when an account is deactivated/reactivated).
//
// It lives in its own file because session.js imports service.js; putting the cache in either would create an
// import cycle. Root cause of the "I signed in with Google again but stayed signed out" bug: reactivating an
// account on the native/Google/Apple paths did NOT clear this cache, so for up to 5 seconds the freshly issued
// token was still judged by the stale "deactivated" answer, /api/auth/me returned 401, and the app treated the
// person as signed out. Every state change now invalidates it.
const cache = new Map();
const TTL = 5000;

export function getCachedSession(accountId) {
  const hit = cache.get(accountId);
  return hit && hit.until > Date.now() ? hit : null;
}
export function setCachedSession(accountId, ok) {
  cache.set(accountId, { ok, until: Date.now() + TTL });
  if (cache.size > 5000) cache.clear();
}
export function invalidateSession(accountId) { if (accountId) cache.delete(accountId); }
export function invalidateAllSessions() { cache.clear(); }
