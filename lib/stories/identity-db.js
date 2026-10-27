// Identity-side tables for Stories. Anything keyed by ACCOUNT lives here (never in the content
// store): employment verification, saved searches, enterprise leads. Created lazily, idempotent.
import { identityDb } from "../identity/db.js";
let ready;
export function storiesIdentityReady() {
  if (!ready) ready = (async () => {
    await identityDb.exec(`CREATE TABLE IF NOT EXISTS employment_verifications (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, company_key TEXT NOT NULL, company_name TEXT NOT NULL, company_id TEXT,
      kind TEXT NOT NULL DEFAULT 'current',            -- current | former
      method TEXT NOT NULL,                            -- work_email | document
      email_domain TEXT,                               -- the domain only; the address itself is never stored
      code_hash TEXT, code_expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      document_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending',          -- pending | verified | rejected | expired | ended
      note TEXT, reviewed_by TEXT, verified_at TEXT, expires_at TEXT, created_at TEXT NOT NULL)`);
    await identityDb.exec("CREATE INDEX IF NOT EXISTS idx_empver_account ON employment_verifications (account_id, status)");
    await identityDb.exec("CREATE INDEX IF NOT EXISTS idx_empver_status ON employment_verifications (status, created_at)");
    await identityDb.exec(`CREATE TABLE IF NOT EXISTS saved_searches (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, label TEXT NOT NULL, query TEXT NOT NULL, alerts INTEGER NOT NULL DEFAULT 1,
      last_alert_at TEXT, created_at TEXT NOT NULL)`);
    await identityDb.exec("CREATE INDEX IF NOT EXISTS idx_saved_searches_account ON saved_searches (account_id)");
    await identityDb.exec(`CREATE TABLE IF NOT EXISTS enterprise_leads (
      id TEXT PRIMARY KEY, company_name TEXT NOT NULL, contact_name TEXT, email TEXT NOT NULL, team_size TEXT, message TEXT,
      status TEXT NOT NULL DEFAULT 'new', handled_by TEXT, created_at TEXT NOT NULL)`);
    await identityDb.exec("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS premium_interval TEXT");
  })().catch((e) => { ready = null; throw e; });
  return ready;
}
export { identityDb };
