// Identity Service storage — the PII vault.
//
// Runs in Postgres, in its own SQL schema ("identity") — deliberately
// separate from the "content" schema (lib/content/db.js). That logical
// separation is the point: nothing in the content service can join
// across these stores, and nothing in this file ever needs to know what
// someone posted. See the Moderation & Anonymity Architecture doc,
// Section 2 ("Identity Architecture") for the design this implements. If
// you want a stronger, physical version of that boundary (separate
// Postgres instances, separate access credentials, separate backups),
// set IDENTITY_DATABASE_URL to a different connection string than
// CONTENT_DATABASE_URL/DATABASE_URL — see lib/db/pg-client.js and
// DEPLOYMENT.md.
//
// Was SQLite (node:sqlite) prior to the Postgres migration — that file's
// comment used to say "swap this file for a real Postgres client later;
// nothing outside lib/identity/ should need to change since callers only
// ever go through lib/identity/service.js." That held: this file and
// lib/identity/service.js are the only two files that changed for the
// migration itself (every app/api/** route already only calls into
// service.js, and just needed `await` added at call sites since a real
// network database can't be queried synchronously the way SQLite could).
//
// This assumes a fresh Postgres database, not an upgrade path from an
// existing data/identity.db — the old file's incremental ALTER-TABLE
// "ensureColumn" migrations (useful for evolving one long-lived SQLite
// file) were dropped in favor of the one, current, correct schema below.
// See DEPLOYMENT.md's "Migrating existing SQLite data" section if you
// have real users in data/identity.db to carry over.
import { PgDatabase, getPool } from "../db/pg-client.js";
import { candidateKeys } from "../avatar-art.js";
import { migrateIdentityAdmin } from "../admin/schema.js";

export const identityDb = new PgDatabase(getPool("identity", { searchPath: "identity,public" }));

// search_path is set as a connection startup parameter in getPool() (see
// lib/db/pg-client.js) — no per-connection SET needed here.

identityDb.setInitializer(async () => {
  await identityDb.exec(`CREATE SCHEMA IF NOT EXISTS identity;`);
  await createIdentityTables();
  await migrateAddPremiumTierColumn();
  await migratePhoneAndAvatarColumns();
  await migrateProfileViews();
  await migrateActionCodes();
  await backfillAvatarStyles();
  await seedBadgeDefsIfNeeded();
  await migrateIdentityAdmin((sql) => identityDb.exec(sql));
});

async function createIdentityTables() {
  await identityDb.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    real_name TEXT NOT NULL,
    pseudonym TEXT UNIQUE,
    bio TEXT NOT NULL DEFAULT '',
    -- Full URL to the avatar in object storage (public bucket), or NULL.
    -- Column name kept from the pre-migration on-disk-path era to avoid
    -- an unnecessary rename — see lib/avatars.js.
    avatar_path TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    phone TEXT,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    country TEXT,
    account_type TEXT NOT NULL DEFAULT 'personal',
    interests TEXT NOT NULL DEFAULT '[]',
    government_id_status TEXT NOT NULL DEFAULT 'none',
    business_verified_status TEXT NOT NULL DEFAULT 'none',
    professional_verified_status TEXT NOT NULL DEFAULT 'none',
    google_id TEXT UNIQUE,
    apple_id TEXT UNIQUE,
    is_premium INTEGER NOT NULL DEFAULT 0,
    -- 'basic' | 'plus' | 'pro'. is_premium above is kept in sync
    -- (is_premium = premium_tier != 'basic') for the existing badge/
    -- notification code that only cares about "premium or not"; anything
    -- that needs the specific tier (usage limits, Vent Room access) reads
    -- this column directly. See lib/identity/service.js's setPremiumTier.
    premium_tier TEXT NOT NULL DEFAULT 'basic',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    subscription_status TEXT,
    pseudonym_changed_at TEXT,
    real_name_changed_at TEXT,
    deactivated INTEGER NOT NULL DEFAULT 0,
    deactivated_at TEXT,
    created_at TEXT NOT NULL
  );

  -- One row per issued anonymous identity. "alias" mode identities are
  -- reused across posts (persistent pseudonym — see accounts.pseudonym);
  -- "anon" mode identities are minted fresh per post and never reused.
  -- Either way, this table is the *only* place an anonymous_id can be
  -- traced back to an account_id.
  CREATE TABLE IF NOT EXISTS anonymous_identities (
    anonymous_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    display_label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  -- Break-glass audit log: one row per *completed* resolution, written by
  -- approveBreakGlass() only after a second, distinct operator has signed
  -- off on the pending request. There is no HTTP route that reaches this —
  -- see scripts/break-glass-request.js and scripts/break-glass-approve.js,
  -- and architecture doc Section 2.4.
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    anonymous_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by TEXT NOT NULL DEFAULT '',
    resolved_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- The two-person break-glass workflow itself: a request sits here as
  -- 'pending' until a *different* operator approves it. Requests expire
  -- (default 24h) so a stale, forgotten request can't be approved months
  -- later against a case nobody remembers.
  CREATE TABLE IF NOT EXISTS break_glass_requests (
    id TEXT PRIMARY KEY,
    anonymous_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    approved_by TEXT,
    requested_at TEXT NOT NULL,
    approved_at TEXT,
    expires_at TEXT NOT NULL
  );

  -- Billing history. Populated by real Stripe webhook events (event: 'stripe_checkout_created',
  -- 'stripe_subscription_active', 'stripe_subscription_canceled', etc.) —
  -- see lib/stripe.js and app/api/stripe/webhook/route.js.
  CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    event TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Backing store for the rate limiter (lib/identity/rate-limit.js). One
  -- row per attempted action; checked as a rolling window, not a fixed
  -- bucket. Lives here rather than in the content schema so the limit is
  -- enforced against a real account id before any anonymous content
  -- token is ever issued — see architecture doc Section 5.
  CREATE TABLE IF NOT EXISTS rate_limit_events (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Email verification links (sent via Resend, see lib/email.js). A token
  -- is single-use and expires; unverified accounts can still use the app
  -- (email verification is encouraged, not gated) — see lib/identity/service.js.
  CREATE TABLE IF NOT EXISTS email_verifications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Password reset links. The request endpoint always returns the same
  -- generic response regardless of whether the email exists, so this
  -- table (and its tokens) are never a way to enumerate real accounts.
  CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- In-app notifications. Delivered via getAccountIdForRouting() — an
  -- internal, non-audited lookup distinct from break-glass (see
  -- lib/identity/service.js for why that distinction matters).
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    related_post_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- One row per (account, device) — Expo push tokens for native push
  -- delivery. A single account can have several (phone + tablet, or a
  -- reinstall that generated a new token) so this is keyed by the token
  -- itself, not one-per-account.
  CREATE TABLE IF NOT EXISTS push_tokens (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT,
    created_at TEXT NOT NULL
  );

  -- Per-category delivery preferences. One row per (account, category);
  -- absence of a row means "all channels on" (the default), so this table
  -- only needs to store the categories someone has actually changed —
  -- see getNotificationPreferences()'s default-merge logic.
  CREATE TABLE IF NOT EXISTS notification_preferences (
    account_id TEXT NOT NULL,
    category TEXT NOT NULL,
    in_app INTEGER NOT NULL DEFAULT 1,
    email INTEGER NOT NULL DEFAULT 1,
    push INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (account_id, category)
  );

  -- Follows: an account follows an alias handle (a stable anonymous_id
  -- in 'alias' mode — the same identity the public /u/[handle] profile
  -- page and post-author click-through use). Deliberately NOT built on
  -- account-to-account follows: you're following a persona, consistent
  -- with everything else here staying pseudonym-first. An 'anon'-mode
  -- identity can never appear as a followed_handle — nothing writes one
  -- there (see followHandle's own guard) — so the "never linkable"
  -- guarantee for fully-anonymous posts holds here too.
  CREATE TABLE IF NOT EXISTS follows (
    follower_account_id TEXT NOT NULL,
    followed_handle TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (follower_account_id, followed_handle)
  );

  -- One-time SMS codes (see lib/identity/phone-otp.js). Only a keyed hash
  -- of the code is stored, never the code itself. A row is deleted the
  -- moment it is used, expires, or burns its attempts — nothing lingers.
  CREATE TABLE IF NOT EXISTS phone_otps (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- SMS abuse ledger: one row per code request or verify attempt, holding
  -- only hashes of the phone number and IP. This is what the fraud rules
  -- (per account / per number / per IP / per country / global) count over.
  CREATE TABLE IF NOT EXISTS sms_events (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    phone_hash TEXT,
    ip_hash TEXT,
    country_prefix TEXT,
    kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- General-purpose keyed throttle (IP / email / phone-hash keyed limits
  -- that are not tied to a logged-in account). See lib/identity/rate-limit.js.
  CREATE TABLE IF NOT EXISTS throttle_events (
    id TEXT PRIMARY KEY,
    throttle_key TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Government ID / Business / Professional verification requests. This
  -- is a REAL, functional manual-review workflow — not an instant fake
  -- approval. See scripts/review-verification.js: an operator reviews
  -- submitted_data and approves or rejects. document_path stores the
  -- PRIVATE object-storage key (never a public URL — see
  -- lib/identity/documents.js and DEPLOYMENT.md's Object Storage
  -- section). Automated instant verification would need a KYC vendor
  -- (Persona, Stripe Identity, etc.), not implemented here — see README.
  CREATE TABLE IF NOT EXISTS verification_requests (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    type TEXT NOT NULL,
    submitted_data TEXT NOT NULL,
    document_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TEXT,
    review_note TEXT,
    created_at TEXT NOT NULL
  );

  -- Gamification. badge_defs is the catalog (seeded once, see below);
  -- account_badges is who has earned what. Awarded automatically by
  -- checkAndAwardBadges(), called after actions that could trigger one
  -- (posting, verifying email, etc.) — see lib/identity/service.js.
  CREATE TABLE IF NOT EXISTS badge_defs (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS account_badges (
    account_id TEXT NOT NULL,
    badge_key TEXT NOT NULL,
    awarded_at TEXT NOT NULL,
    PRIMARY KEY (account_id, badge_key)
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limit_account_action_time
  ON rate_limit_events (account_id, action, created_at);

  CREATE INDEX IF NOT EXISTS idx_notifications_account_created
  ON notifications (account_id, created_at);
  -- Added for load speed: every post render resolves author aliases and
  -- every follow/profile view looks accounts up through these.
  CREATE INDEX IF NOT EXISTS idx_anon_identities_account ON anonymous_identities (account_id, mode);
  CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows (followed_handle);
  CREATE INDEX IF NOT EXISTS idx_phone_otps_account ON phone_otps (account_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_phone_otps_expires ON phone_otps (expires_at);
  CREATE INDEX IF NOT EXISTS idx_sms_events_account ON sms_events (account_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_sms_events_phone ON sms_events (phone_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_sms_events_ip ON sms_events (ip_hash, created_at);
  CREATE INDEX IF NOT EXISTS idx_sms_events_time ON sms_events (created_at);
  CREATE INDEX IF NOT EXISTS idx_throttle_key_action ON throttle_events (throttle_key, action, created_at);
`);
}

// This app already had a real accounts table (with real seeded data) in
// production before the Basic/Plus/Pro tier system existed —
// CREATE TABLE IF NOT EXISTS above is a no-op against a table that
// already exists, so the new column needs its own explicit, idempotent
// migration. Safe to run on every boot: ADD COLUMN IF NOT EXISTS is a
// no-op once the column is there.
async function migrateAddPremiumTierColumn() {
  await identityDb.exec(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS premium_tier TEXT NOT NULL DEFAULT 'basic';`);
  // Backfill: any account already flagged is_premium under the old
  // boolean-only system becomes 'pro' (the tier closest to what
  // "Premium" used to mean — full access, no caps) rather than being
  // silently downgraded to 'basic' the moment this ships.
  await identityDb.exec(`UPDATE accounts SET premium_tier = 'pro' WHERE is_premium = 1 AND premium_tier = 'basic';`);
}

// Profile views power "Who viewed your profile" and Profile analytics.
// Stores the viewer's account id server-side only; what a profile owner can
// SEE is decided per plan in getProfileViewsFor() and never includes real
// identity — only the viewer's public pseudonym, and only on higher plans.
async function migrateProfileViews() {
  await identityDb.exec(`CREATE TABLE IF NOT EXISTS profile_views (
    id BIGSERIAL PRIMARY KEY,
    target_account_id TEXT NOT NULL,
    viewer_account_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  await identityDb.exec(`CREATE INDEX IF NOT EXISTS profile_views_target_idx ON profile_views (target_account_id, created_at);`);
}

// One-time email codes that confirm a sensitive account action (deactivate, delete). Only a salted
// hash of the code is stored; rows expire after 10 minutes and are removed once used.
async function migrateActionCodes() {
  await identityDb.exec(`CREATE TABLE IF NOT EXISTS account_action_codes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );`);
  await identityDb.exec(`CREATE INDEX IF NOT EXISTS account_action_codes_idx ON account_action_codes (account_id, purpose);`);
}

// Phone-code and avatar changes for an already-running database. Idempotent.
async function migratePhoneAndAvatarColumns() {
  // The Twilio-era table stored codes in plaintext. It is dropped outright:
  // any code in it is at most minutes old and useless without the SMS.
  await identityDb.exec(`DROP TABLE IF EXISTS phone_verifications;`);

  // Every account gets a distinct generated avatar style (lib/avatar-art.js).
  // UNIQUE is what guarantees no two accounts ever share one.
  await identityDb.exec(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_style TEXT;`);
  await identityDb.exec(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sound_prefs TEXT;`);
  await identityDb.exec(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS dm_prefs TEXT;`);
  await identityDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_avatar_style ON accounts (avatar_style) WHERE avatar_style IS NOT NULL;`);

  // A verified phone number can belong to one account only. If historic
  // data already has duplicates this index cannot be built; the app keeps
  // running and the service layer still checks in code.
  try {
    await identityDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_verified_phone ON accounts (phone) WHERE phone_verified = 1;`);
  } catch (e) {
    console.error("[identity] could not create unique verified-phone index (duplicate verified numbers exist):", e.message);
  }
}

// Gives every existing account its own generated avatar style. Runs inside
// the initializer, so it uses pool.query directly (see seedBadgeDefsIfNeeded
// for why going through .prepare() here would deadlock).
export const STYLES_PER_GENERATION = 16 * 24;

export async function assignAvatarStyleWith(query, accountId) {
  const cur = await query("SELECT avatar_style FROM accounts WHERE id = $1", [accountId]);
  if (!cur.rows[0] || cur.rows[0].avatar_style) return cur.rows[0]?.avatar_style || null;
  const { rows } = await query("SELECT COUNT(*)::int AS n FROM accounts WHERE avatar_style IS NOT NULL");
  for (let gen = Math.floor(rows[0].n / STYLES_PER_GENERATION); gen < 1000; gen++) {
    for (const key of candidateKeys(accountId, gen)) {
      try {
        const res = await query("UPDATE accounts SET avatar_style = $1 WHERE id = $2 AND avatar_style IS NULL", [key, accountId]);
        if (res.rowCount === 1) return key;
        return (await query("SELECT avatar_style FROM accounts WHERE id = $1", [accountId])).rows[0]?.avatar_style || null;
      } catch (e) {
        if (e.code !== "23505") throw e; // unique violation = style taken, try the next one
      }
    }
  }
  return null;
}

async function backfillAvatarStyles() {
  const q = (sql, params) => identityDb.pool.query(sql, params);
  const { rows } = await q("SELECT id FROM accounts WHERE avatar_style IS NULL ORDER BY created_at");
  for (const r of rows) await assignAvatarStyleWith(q, r.id);
}

// password_hash predates OAuth signup (Google/Apple accounts have no
// password) — nullable by design in the CREATE TABLE above, so
// OAuth-only accounts simply never get a row there.

// Badge catalog — seeded once. Adding a new badge later just means adding
// a row here; award logic lives in checkAndAwardBadges() in service.js.
const BADGE_DEFS = [
  { key: "first_post", label: "First Confession", description: "Posted your first rant, confession, or receipt.", icon: "sparkle" },
  { key: "prolific_10", label: "Prolific Venter", description: "Posted 10 times.", icon: "flame" },
  { key: "prolific_50", label: "Certified Ranter", description: "Posted 50 times.", icon: "flame" },
  { key: "verified_email", label: "Verified", description: "Confirmed your email address.", icon: "check" },
  { key: "verified_phone", label: "Actually Reachable", description: "Confirmed your phone number.", icon: "phone" },
  { key: "premium_member", label: "Premium", description: "Upgraded to LinkedOut Premium.", icon: "star" },
  { key: "company_founder", label: "Whistleblower", description: "Started a company page.", icon: "flag" },
  { key: "cringe_champion", label: "Cringe Champion", description: "Had a post hit #1 on the Cringe Awards.", icon: "trophy" },
  { key: "commenter", label: "Has Opinions", description: "Left 10 comments.", icon: "message" },
  { key: "reposter", label: "Signal Booster", description: "Reposted 5 times.", icon: "repeat" },
];

// Uses identityDb.pool.query() directly rather than identityDb.prepare(...)
// — this function runs INSIDE the lazy initializer above (called from
// ensureReady()), so going through .prepare().run() here would call
// ensureReady() again and deadlock waiting on the very readiness promise
// this function is part of resolving. See lib/content/db.js's
// seedAdsIfEmpty() for the same pattern.
async function seedBadgeDefsIfNeeded() {
  for (const b of BADGE_DEFS) {
    await identityDb.pool.query(
      "INSERT INTO badge_defs (key, label, description, icon) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING",
      [b.key, b.label, b.description, b.icon]
    );
  }
}
