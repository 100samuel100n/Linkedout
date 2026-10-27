// Schema additions for the admin system. Called from the existing lazy
// initializers in lib/identity/db.js and lib/content/db.js (see the one-line
// hooks there) so it follows the same "runs once, before first query" rule.
// Identity-side tables hold anything tied to an ACCOUNT; content-side tables
// hold anything tied to a post/room/DM — preserving the existing boundary.

export async function migrateIdentityAdmin(exec) {
  // Live presence: one row per person per platform, refreshed by a heartbeat while the app/site is in view.
  await exec(`CREATE TABLE IF NOT EXISTS presence (
    account_id TEXT NOT NULL, platform TEXT NOT NULL, last_seen_at TEXT NOT NULL, country TEXT, city TEXT, since TEXT,
    PRIMARY KEY (account_id, platform)
  );
  CREATE INDEX IF NOT EXISTS idx_presence_seen ON presence (last_seen_at);`);
  await exec(`
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status_until TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS restrictions TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_label TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS must_reset_password INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_seen_at TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_secret TEXT;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS totp_recovery TEXT;
    CREATE TABLE IF NOT EXISTS daily_active (account_id TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (account_id, day));
    CREATE INDEX IF NOT EXISTS idx_daily_active_day ON daily_active (day);
    ALTER TABLE dmca_notices ADD COLUMN IF NOT EXISTS claimant_email TEXT;
    ALTER TABLE dmca_notices ADD COLUMN IF NOT EXISTS work_description TEXT;
    ALTER TABLE dmca_notices ADD COLUMN IF NOT EXISTS target_url TEXT;
    ALTER TABLE dmca_notices ADD COLUMN IF NOT EXISTS signature TEXT;
    ALTER TABLE dmca_notices ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff';
    ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS requester_name TEXT;
    ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS requester_email TEXT;
    ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS reference TEXT;
    ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS details TEXT;
    ALTER TABLE legal_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assignee_id TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_at TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS contact_name TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS contact_email TEXT;
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app';
    CREATE TABLE IF NOT EXISTS enforcements (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
      issued_by TEXT NOT NULL, expires_at TEXT, revoked_at TEXT, revoked_by TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_enforcements_account ON enforcements (account_id, created_at);
    CREATE TABLE IF NOT EXISTS appeals (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, enforcement_id TEXT, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decision_note TEXT, created_at TEXT NOT NULL, decided_at TEXT);
    CREATE TABLE IF NOT EXISTS staff_audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, action TEXT NOT NULL,
      target TEXT, detail TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_staff_audit_time ON staff_audit_log (created_at);
    CREATE TABLE IF NOT EXISTS legal_requests (
      id TEXT PRIMARY KEY, agency TEXT NOT NULL, type TEXT NOT NULL, subject TEXT, deadline TEXT,
      status TEXT NOT NULL DEFAULT 'open', handled_by TEXT, note TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dmca_notices (
      id TEXT PRIMARY KEY, claimant TEXT NOT NULL, target_post_id TEXT, description TEXT,
      status TEXT NOT NULL DEFAULT 'open', handled_by TEXT, created_at TEXT NOT NULL);
    ALTER TABLE accounts ADD COLUMN IF NOT EXISTS support_seen INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, kind TEXT NOT NULL, author_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_support_msgs_ticket ON support_messages (ticket_id, created_at);
    CREATE TABLE IF NOT EXISTS broadcasts (
      id TEXT PRIMARY KEY, channel TEXT NOT NULL, name TEXT, subject TEXT, title TEXT, body TEXT NOT NULL,
      cta_label TEXT, cta_url TEXT, audience TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'marketing', in_app INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'scheduled', scheduled_at TEXT, created_by TEXT, created_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT, total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, error TEXT);
    CREATE INDEX IF NOT EXISTS idx_broadcasts_due ON broadcasts (status, scheduled_at);
    CREATE TABLE IF NOT EXISTS support_macros (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY, account_id TEXT, subject TEXT NOT NULL, body TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'open', handled_by TEXT, created_at TEXT NOT NULL);
  `);
}

export async function migrateContentAdmin(q) {
  await q(`CREATE TABLE IF NOT EXISTS content_reports (
    id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reporter_key TEXT NOT NULL,
    reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open', resolution TEXT,
    handled_by TEXT, created_at TEXT NOT NULL, resolved_at TEXT)`);
  await q("CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at)");
  await q("ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderated_by TEXT");
  await q("ALTER TABLE posts ADD COLUMN IF NOT EXISTS moderated_at TEXT");
  await q("ALTER TABLE posts ADD COLUMN IF NOT EXISTS mod_reason TEXT");
  await q("ALTER TABLE ads ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'approved'");
  // Likes are their own thing now — separate table, separate counts, separate
  // from emoji reactions. Existing ❤️ reactions on posts are moved over once
  // (idempotent: re-running copies nothing new and deletes nothing more).
  await q(`CREATE TABLE IF NOT EXISTS likes (post_id TEXT NOT NULL, anon_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (post_id, anon_key))`);
  await q("CREATE INDEX IF NOT EXISTS idx_likes_anon_time ON likes (anon_key, created_at)");
  await q(`INSERT INTO likes (post_id, anon_key, created_at) SELECT post_id, anon_key, created_at FROM reactions WHERE reaction = '\u2764\uFE0F' ON CONFLICT DO NOTHING`);
  await q(`DELETE FROM reactions WHERE reaction = '\u2764\uFE0F'`);
  await q(`CREATE TABLE IF NOT EXISTS comment_likes (comment_id TEXT NOT NULL, anon_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (comment_id, anon_key))`);
  await q(`INSERT INTO comment_likes (comment_id, anon_key, created_at) SELECT comment_id, anon_key, created_at FROM comment_reactions WHERE reaction = '\u2764\uFE0F' ON CONFLICT DO NOTHING`);
  await q(`DELETE FROM comment_reactions WHERE reaction = '\u2764\uFE0F'`);
  // Advertising system
  await q(`CREATE TABLE IF NOT EXISTS advertisers (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_email TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL)`);
  for (const [c, t] of [["advertiser_id", "TEXT"], ["name", "TEXT"], ["starts_at", "TEXT"], ["ends_at", "TEXT"], ["total_budget_cents", "INTEGER"], ["cpm_cents", "INTEGER NOT NULL DEFAULT 500"], ["reject_reason", "TEXT"], ["created_at", "TEXT"], ["updated_at", "TEXT"]]) await q(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  await q(`CREATE TABLE IF NOT EXISTS ad_events (id TEXT PRIMARY KEY, ad_id INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_ad_events_ad ON ad_events (ad_id, kind)");
  await q("CREATE INDEX IF NOT EXISTS idx_ad_events_time ON ad_events (created_at)");
  await q("ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS country TEXT");
  await q("ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS city TEXT");
  // Feed controls + announcements
  await q(`CREATE TABLE IF NOT EXISTS feed_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, severity TEXT NOT NULL DEFAULT 'info', audience TEXT NOT NULL DEFAULT 'all', starts_at TEXT, ends_at TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS blocked_terms (term TEXT PRIMARY KEY, added_by TEXT, created_at TEXT NOT NULL)`);
}
