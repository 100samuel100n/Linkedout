// Content Service storage. Logically separate from the identity store
// (lib/identity/db.js) — this table set has no column that can ever hold
// an email, password hash, or real name. Everything here references
// either an `anonymous_id` (an opaque string minted by the identity
// service, shown to nobody) or an `anon_key` (used purely for
// server-side dedup — "has this account already reacted to this post" —
// never returned to any client) plus a plain-text `*_display` label.
// That's the entire boundary: even with full read access to this schema,
// there's no way back to who someone is.
//
// Runs in Postgres, in its own SQL schema ("content") — see
// lib/db/pg-client.js for how that pool is configured and how to point
// it at a physically separate Postgres instance if you want that
// stronger boundary. Was SQLite (node:sqlite) prior to the Postgres
// migration; the incremental ALTER-TABLE migrations that made sense for
// evolving a single SQLite file over time were dropped here in favor of
// the one, current, correct schema — this file assumes a fresh Postgres
// database, not an upgrade path from the old SQLite one. See
// DEPLOYMENT.md's "Migrating existing SQLite data" section if you have
// real data in data/content.db to carry over.
//
// Companies, jobs, and rooms used to be static seed arrays. They aren't
// anymore — every row here is created through the same real
// createX()/POST route path as a post, always attributed to a real
// account via anonymous_id. See scripts/seed-content.js for how the
// initial "cold start" content actually gets created (real accounts,
// real API calls) rather than being injected as fake data.
import crypto from "node:crypto";
import { migrateContentAdmin } from "../admin/schema.js";
import { migrateStories } from "../stories/db.js";
import { migrateViews } from "../views.js";
import { PgDatabase, getPool } from "../db/pg-client.js";
import { ROAST_LINES, ADS } from "../data.js";

export const contentDb = new PgDatabase(getPool("content", { searchPath: "content,public" }));

// search_path is set as a connection startup parameter in getPool() (see
// lib/db/pg-client.js) — no per-connection SET needed here.

// Schema creation, table creation, and ad seeding all happen lazily, on
// the FIRST real query this process makes — not here, at import time.
// This is registered via setInitializer() and only actually runs inside
// PreparedStatement.get/all/run (see lib/db/pg-client.js). That matters
// because Next.js imports every API route module during `next build` to
// collect route config, without ever running the route — if this ran at
// import time instead, `next build` itself would try to open a real
// Postgres connection and fail in any build environment with no database
// reachable (exactly the ECONNREFUSED error this replaced).
contentDb.setInitializer(async () => {
  await contentDb.exec(`CREATE SCHEMA IF NOT EXISTS content;`);
  await createContentTables();
  await migrateRoomsAndReposts();
  await migrateContentAdmin((sql) => contentDb.pool.query(sql));
  await migrateStories((sql, params) => contentDb.pool.query(sql, params));
  await migrateViews((sql, params) => contentDb.pool.query(sql, params)); // view metrics: recorded now, shown later
  await seedAdsIfEmpty();
});

async function createContentTables() {
  await contentDb.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    mood TEXT NOT NULL,
    title TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'public',
    scheduled_at TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    media_type TEXT,
    -- Full URL to the object in storage (public bucket), or NULL. Was a
    -- relative on-disk path served through a proxy route before the
    -- object-storage migration — see lib/media.js.
    media_path TEXT,
    poll_multi INTEGER NOT NULL DEFAULT 0,
    multi_select INTEGER NOT NULL DEFAULT 0,
    event_at TEXT,
    event_location TEXT,
    repost_of TEXT,
    quote_text TEXT,
    cringe_nominated INTEGER NOT NULL DEFAULT 0,
    cringe_votes INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    author_display TEXT NOT NULL,
    anonymous_id TEXT,
    time_label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    text TEXT NOT NULL,
    cry INTEGER NOT NULL DEFAULT 0,
    laugh INTEGER NOT NULL DEFAULT 0,
    skull INTEGER NOT NULL DEFAULT 0,
    flag INTEGER NOT NULL DEFAULT 0
  );

  -- Real per-account reaction dedup. anon_key is the account's persistent
  -- "alias" anonymous_id (see lib/identity/service.js's getOrCreateAlias),
  -- reused here purely as a stable, opaque, per-account key — it is NEVER
  -- returned in any API response from this table.
  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    reaction TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, anon_key, reaction)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anonymous_id TEXT,
    author_display TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    -- Replies can carry an attached file (image/video/document, reusing
    -- the same object-storage pipeline posts use) or a GIF (a URL from
    -- the GIF provider integration — see lib/gifs.js) in addition to text.
    media_type TEXT,
    media_path TEXT,
    gif_url TEXT
  );

  CREATE TABLE IF NOT EXISTS poll_options (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    label TEXT NOT NULL,
    votes INTEGER NOT NULL DEFAULT 0
  );

  -- One vote PER OPTION per person (not one vote per poll) so
  -- multi-select polls work — UNIQUE spans all three columns.
  CREATE TABLE IF NOT EXISTS poll_votes (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, anon_key, option_index)
  );

  -- Cringe Awards voting, deduped the same way reactions are. The
  -- leaderboard itself is just a query over posts WHERE
  -- cringe_nominated = 1 ORDER BY cringe_votes DESC — there's no separate
  -- "awards" table; nomination is a checkbox at post-creation time (see
  -- app/api/posts/route.js).
  CREATE TABLE IF NOT EXISTS cringe_votes (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, anon_key)
  );

  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    description TEXT,
    created_by_anonymous_id TEXT,
    created_by_display TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_reviews (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    anonymous_id TEXT,
    author_display TEXT NOT NULL,
    flag_type TEXT,
    tag_text TEXT,
    body TEXT NOT NULL,
    rating INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_salaries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    anonymous_id TEXT,
    role_title TEXT NOT NULL,
    amount TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_horror_stories (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    anonymous_id TEXT,
    author_display TEXT NOT NULL,
    story TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company_name TEXT NOT NULL,
    salary_min TEXT,
    salary_max TEXT,
    last_person_quit_reason TEXT,
    created_by_anonymous_id TEXT,
    created_by_display TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    vibe TEXT,
    starts_at TEXT,
    created_by_anonymous_id TEXT,
    created_by_display TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Speaker moderation: every room participant has a role (host — the
  -- room's creator, always exactly one; speaker — can publish audio;
  -- listener — can hear and use text/GIF/emoji reactions but not open
  -- their mic). New joiners default to listener and must be promoted.
  -- No UNIQUE(room_id, anon_key): leaving and rejoining writes a new row
  -- (left_at marks the old one inactive) rather than reusing one, so the
  -- same pair can legitimately repeat across a room's history.
  CREATE TABLE IF NOT EXISTS room_participants (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'listener',
    hand_raised INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    left_at TEXT
  );

  -- One row per (post, account) — the DB, not application code, is what
  -- guarantees an account can hold at most ONE repost of a given post.
  -- anon_key is the account's persistent alias id (same dedup key that
  -- reactions/bookmarks use). repost_post_id points at the repost's own row
  -- in posts so un-reposting can remove exactly it.
  CREATE TABLE IF NOT EXISTS reposts (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    repost_post_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, anon_key)
  );

  -- People the host has removed from a room; they can't rejoin it.
  CREATE TABLE IF NOT EXISTS room_bans (
    room_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (room_id, anon_key)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    anon_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(post_id, anon_key)
  );

  CREATE TABLE IF NOT EXISTS ads (id INTEGER PRIMARY KEY, data TEXT NOT NULL);

  CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_repost_of ON posts (repost_of);
  CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions (post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id);
  CREATE INDEX IF NOT EXISTS idx_company_reviews_company ON company_reviews (company_id);
  -- Added for load speed: these columns are filtered/joined on every feed,
  -- profile and company view but had no index (so each lookup scanned the
  -- whole table, which gets slower as real content accumulates).
  CREATE INDEX IF NOT EXISTS idx_posts_anonymous ON posts (anonymous_id);
  CREATE INDEX IF NOT EXISTS idx_poll_options_post ON poll_options (post_id);
  CREATE INDEX IF NOT EXISTS idx_company_salaries_company ON company_salaries (company_id);
  CREATE INDEX IF NOT EXISTS idx_company_horror_company ON company_horror_stories (company_id);
  CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants (room_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_anon ON bookmarks (anon_key);
  CREATE INDEX IF NOT EXISTS idx_reposts_post ON reposts (post_id);
  CREATE INDEX IF NOT EXISTS idx_reposts_anon ON reposts (anon_key);
`);
}

// Direct messages. Everything is keyed by ALIAS ids (never accounts), the
// same boundary used for posts and rooms. Message bodies are encrypted at
// rest (lib/messaging/crypto.js); only ciphertext is ever stored here.
async function migrateMessaging(q) {
  await q(`CREATE TABLE IF NOT EXISTS dm_conversations (
    id TEXT PRIMARY KEY, pair_key TEXT NOT NULL UNIQUE, a_key TEXT NOT NULL, b_key TEXT NOT NULL,
    initiator_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',   -- pending | active | declined
    ttl_seconds INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, accepted_at TEXT, declined_at TEXT, last_message_at TEXT)`);
  await q("ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS priority BOOLEAN NOT NULL DEFAULT FALSE");
  await q("CREATE INDEX IF NOT EXISTS idx_dm_conv_a ON dm_conversations (a_key, last_message_at DESC)");
  await q("CREATE INDEX IF NOT EXISTS idx_dm_conv_b ON dm_conversations (b_key, last_message_at DESC)");
  await q(`CREATE TABLE IF NOT EXISTS dm_members (
    conversation_id TEXT NOT NULL, anon_key TEXT NOT NULL, last_read_at TEXT, last_seen_at TEXT, typing_at TEXT,
    muted INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, cleared_at TEXT, last_notified_at TEXT,
    PRIMARY KEY (conversation_id, anon_key))`);
  await q(`CREATE TABLE IF NOT EXISTS dm_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_key TEXT NOT NULL, body_enc TEXT,
    reply_to TEXT, client_id TEXT, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT, expires_at TEXT,
    UNIQUE (conversation_id, sender_key, client_id))`);
  await q("CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages (conversation_id, created_at)");
  await q("CREATE INDEX IF NOT EXISTS idx_dm_messages_expiry ON dm_messages (expires_at) WHERE expires_at IS NOT NULL");
  await q(`CREATE TABLE IF NOT EXISTS dm_reactions (
    message_id TEXT NOT NULL, anon_key TEXT NOT NULL, reaction TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (message_id, anon_key))`);
  await q(`CREATE TABLE IF NOT EXISTS dm_blocks (
    blocker_key TEXT NOT NULL, blocked_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (blocker_key, blocked_key))`);
  await q(`CREATE TABLE IF NOT EXISTS dm_reports (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, reporter_key TEXT NOT NULL, reported_key TEXT NOT NULL,
    reason TEXT NOT NULL, details TEXT, evidence_enc TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`);
}

// Company registry: legal details, verification state, ownership, audit.
async function migrateCompanyRegistry(q) {
  const cols = [
    ["owner_key", "TEXT"], ["legal_name", "TEXT"], ["name_norm", "TEXT"], ["registration_country", "TEXT"],
    ["registration_number", "TEXT"], ["website", "TEXT"], ["headquarters", "TEXT"], ["size_range", "TEXT"],
    ["founded_year", "INTEGER"], ["relationship", "TEXT"], ["contact_email", "TEXT"],
    ["domain_verified", "INTEGER NOT NULL DEFAULT 0"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],             // active | suspended | deleted
    ["verification", "TEXT NOT NULL DEFAULT 'unverified'"],   // unverified | submitted | verified | rejected
    ["verification_note", "TEXT"], ["verified_at", "TEXT"],
    ["terms_version", "TEXT"], ["terms_accepted_at", "TEXT"],
    ["updated_at", "TEXT"], ["name_changed_at", "TEXT"], ["deleted_at", "TEXT"],
  ];
  for (const [c, t] of cols) await q(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS ${c} ${t}`);
  // Existing pages predate ownership records: the creating alias becomes owner,
  // and they count as listed-but-unverified.
  await q("UPDATE companies SET owner_key = created_by_anonymous_id WHERE owner_key IS NULL");
  await q("UPDATE companies SET name_norm = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g')) WHERE name_norm IS NULL");
  await q("CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies (owner_key)");
  await q("CREATE INDEX IF NOT EXISTS idx_companies_status ON companies (status, verification)");

  await q(`CREATE TABLE IF NOT EXISTS company_documents (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, doc_type TEXT NOT NULL, file_key TEXT NOT NULL,
    filename TEXT, content_type TEXT, size_bytes INTEGER, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_documents_company ON company_documents (company_id)");

  await q(`CREATE TABLE IF NOT EXISTS company_audit (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_audit_company ON company_audit (company_id, created_at)");

  await q(`CREATE TABLE IF NOT EXISTS company_disputes (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
    reporter_key TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_disputes_company ON company_disputes (company_id, status)");

  await q(`CREATE TABLE IF NOT EXISTS company_domain_codes (
    company_id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`);
}

// Idempotent upgrades for a database that already has data.
async function migrateRoomsAndReposts() {
  const q = (sql, params) => contentDb.pool.query(sql, params);
  await migrateCompanyRegistry(q);
  await migrateMessaging(q);
  await q("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'live'");
  await q("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ended_at TEXT");
  await q("ALTER TABLE rooms ADD COLUMN IF NOT EXISTS locked INTEGER NOT NULL DEFAULT 0");
  await q("ALTER TABLE room_participants ADD COLUMN IF NOT EXISTS last_seen_at TEXT");

  // Reactions are free-form emoji now (the four legacy keys become their
  // emoji), one per account per post, and comments get the same system.
  await q(`UPDATE reactions SET reaction = CASE reaction
             WHEN 'cry' THEN '😩' WHEN 'laugh' THEN '😂' WHEN 'skull' THEN '💀' WHEN 'flag' THEN '🚩' ELSE reaction END
           WHERE reaction IN ('cry','laugh','skull','flag')`);
  await q(`DELETE FROM reactions r USING (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY post_id, anon_key ORDER BY created_at DESC, id) AS rn FROM reactions
           ) d WHERE r.id = d.id AND d.rn > 1`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_one_per_account ON reactions (post_id, anon_key)");
  await q(`CREATE TABLE IF NOT EXISTS comment_reactions (
             id TEXT PRIMARY KEY, comment_id TEXT NOT NULL, anon_key TEXT NOT NULL,
             reaction TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(comment_id, anon_key))`);
  await q("CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions (comment_id)");
  await q("CREATE INDEX IF NOT EXISTS idx_reactions_anon_time ON reactions (anon_key, created_at)");

  // Historic duplicate reposts (the old button made a new row per click):
  // keep the first per (original, author), remove the rest, then record the
  // survivors in the reposts table so they can be toggled off.
  await q(`
    DELETE FROM posts p USING (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY repost_of, anonymous_id ORDER BY created_at ASC, id ASC) AS rn
      FROM posts WHERE repost_of IS NOT NULL AND anonymous_id IS NOT NULL
    ) d WHERE p.id = d.id AND d.rn > 1`);
  await q(`
    INSERT INTO reposts (id, post_id, anon_key, repost_post_id, created_at)
    SELECT md5(random()::text || id), repost_of, anonymous_id, id, created_at
    FROM posts WHERE repost_of IS NOT NULL AND anonymous_id IS NOT NULL
    ON CONFLICT (post_id, anon_key) DO NOTHING`);
}

// Only ad inventory is still platform-seeded — ads aren't user-submitted
// content, so this doesn't conflict with "everything belongs to an
// account." Posts, companies, jobs, rooms are NOT seeded here; see
// scripts/seed-content.js for how real accounts create them for real.
//
// Uses contentDb.pool.query() directly rather than contentDb.prepare(...)
// — this function runs INSIDE the lazy initializer above (called from
// ensureReady()), so going through .prepare().get()/.run() here would
// call ensureReady() again and deadlock waiting on the very readiness
// promise this function is part of resolving.
async function seedAdsIfEmpty() {
  const { rows } = await contentDb.pool.query("SELECT COUNT(*) AS n FROM ads");
  if (Number(rows[0].n) === 0) {
    for (const a of ADS) {
      await contentDb.pool.query("INSERT INTO ads (id, data) VALUES ($1, $2)", [a.id, JSON.stringify(a)]);
    }
  }
}

export function rowToComment(row) {
  return {
    id: row.id,
    postId: row.post_id,
    author: row.author_display,
    text: row.text,
    mediaType: row.media_type || null,
    // Full object-storage URL, stored directly at attach time — see
    // attachMediaToComment() in lib/content/service.js.
    mediaUrl: row.media_path || null,
    gifUrl: row.gif_url || null,
    likeCount: 0,
    myLike: false,
    createdAt: row.created_at,
    time: formatRelativeTime(row.created_at),
  };
}

export function rowToPost(row, extra = {}) {
  return {
    id: row.id,
    type: row.type,
    mood: row.mood,
    title: row.title || null,
    category: row.category || null,
    tags: JSON.parse(row.tags || "[]"),
    visibility: row.visibility,
    scheduledAt: row.scheduled_at || null,
    pinned: !!row.pinned,
    mediaType: row.media_type || null,
    // Full object-storage URL, stored directly at upload time — see
    // savePostMedia() in lib/media.js and app/api/posts/route.js. No
    // proxy route needed: post media is public-by-design, so the client
    // hits the storage URL (or CDN in front of it) directly.
    mediaUrl: row.media_path || null,
    pollMulti: !!row.poll_multi,
    eventAt: row.event_at || null,
    eventLocation: row.event_location || null,
    repostOf: row.repost_of || null,
    quoteText: row.quote_text || null,
    cringeNominated: !!row.cringe_nominated,
    cringeVotes: row.cringe_votes,
    commentCount: row.comment_count,
    author: row.author_display,
    // Computed fresh from created_at on every read, not stored — a
    // previous version of this app stored the literal string "now" at
    // post-creation time and never updated it, so every post displayed
    // "now ago" forever, even years later. time_label the column still
    // exists for schema-compat but is no longer read; createdAt (the
    // real ISO timestamp) is the actual source of truth.
    time: formatRelativeTime(row.created_at),
    createdAt: row.created_at,
    text: row.text,
    // Filled in from the reactions table (see attachBatchExtras); these
    // defaults only apply to rows built without it.
    reactions: { total: 0, top: [] },
    likeCount: 0,
    myLike: false,
    ...extra,
  };
}

// "2m ago", "3h ago", "5d ago", "2w ago", "4mo ago", "1y ago" — the "ago"
// is baked in here (not appended by the frontend) specifically to make
// "just now" read correctly instead of the awkward "just now ago".
export function formatRelativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 4) return `${diffWeek}w ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffDay / 365)}y ago`;
}

export { crypto };
export const ROAST_LINES_SEED = ROAST_LINES;
