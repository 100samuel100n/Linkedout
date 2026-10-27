// Stories storage. Same boundary as the rest of the content store: only
// alias ids (`anonymous_id` / `anon_key`) and plain display labels — never an
// account id, email or real name.
export async function migrateStories(q) {
  await q(`CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    format TEXT NOT NULL DEFAULT 'experience',
    title TEXT,
    who TEXT,
    company_id TEXT,
    company_name TEXT,
    company_key TEXT,                -- normalised name, so unlisted companies still aggregate
    industry TEXT,
    department TEXT, role_title TEXT, tenure TEXT, location TEXT,
    period TEXT,                     -- free text: "March 2026", "last winter"
    happened_on TEXT,                -- ISO date if known (drives timelines / trends)
    body TEXT NOT NULL,
    told TEXT, actual TEXT, impact TEXT,
    categories TEXT NOT NULL DEFAULT '[]',
    wants TEXT NOT NULL DEFAULT '[]',
    no_advice INTEGER NOT NULL DEFAULT 0,
    details TEXT NOT NULL DEFAULT '{}',   -- format-specific structured fields (JSON)
    leave_reasons TEXT NOT NULL DEFAULT '[]',
    outcome TEXT NOT NULL DEFAULT 'ongoing',
    employment_claim TEXT,           -- self-declared: current | former | applicant | customer
    verified_employment INTEGER NOT NULL DEFAULT 0,  -- set only by a private verification flow
    circle_id TEXT,
    status TEXT NOT NULL DEFAULT 'published',        -- published | draft | scheduled | removed
    publish_at TEXT,
    mode TEXT NOT NULL DEFAULT 'alias',
    author_display TEXT NOT NULL,
    anonymous_id TEXT,
    source_post_id TEXT,             -- the Pulse post this Story grew out of
    redactions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  await q("CREATE INDEX IF NOT EXISTS idx_stories_feed ON stories (status, created_at DESC)");
  await q("CREATE INDEX IF NOT EXISTS idx_stories_company ON stories (company_id, created_at DESC)");
  await q("CREATE INDEX IF NOT EXISTS idx_stories_company_key ON stories (company_key)");
  await q("CREATE INDEX IF NOT EXISTS idx_stories_author ON stories (anonymous_id)");
  await q("CREATE INDEX IF NOT EXISTS idx_stories_format ON stories (format, created_at DESC)");

  await q(`CREATE TABLE IF NOT EXISTS story_me_too (
    story_id TEXT NOT NULL, anon_key TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'same',          -- same | similar
    same_company INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, PRIMARY KEY (story_id, anon_key))`);

  await q(`CREATE TABLE IF NOT EXISTS story_updates (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'update',  -- update | correction | milestone
    body TEXT NOT NULL, event_on TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_story_updates_story ON story_updates (story_id, created_at)");

  // Receipts. Files live in PRIVATE storage; only the metadata + a label are public.
  await q(`CREATE TABLE IF NOT EXISTS story_evidence (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
    file_key TEXT, content_type TEXT, size_bytes INTEGER, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_story_evidence_story ON story_evidence (story_id)");

  await q(`CREATE TABLE IF NOT EXISTS story_follows (
    story_id TEXT NOT NULL, anon_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (story_id, anon_key))`);

  // Right of reply: verified company representatives answer stories or publish
  // their own account of events. Visible next to — never instead of — the story.
  await q(`CREATE TABLE IF NOT EXISTS company_responses (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, story_id TEXT, kind TEXT NOT NULL DEFAULT 'reply', -- reply | explanation
    body TEXT NOT NULL, responder_key TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_responses_company ON company_responses (company_id, created_at)");
  await q("CREATE INDEX IF NOT EXISTS idx_company_responses_story ON company_responses (story_id)");

  // Reality Check: a company claim, and what people say it's actually like.
  await q(`CREATE TABLE IF NOT EXISTS company_claims (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, topic TEXT, claim TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',      -- user | company
    submitted_by TEXT, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS claim_checks (
    id TEXT PRIMARY KEY, claim_id TEXT NOT NULL, anonymous_id TEXT, author_display TEXT NOT NULL,
    verdict TEXT NOT NULL,                     -- matches | mixed | differs
    body TEXT, created_at TEXT NOT NULL,
    UNIQUE (claim_id, anonymous_id))`);

  // Publicly documented events (news, filings, regulator notices). Only staff add these;
  // this is what separates "user-reported" from "publicly documented".
  await q(`CREATE TABLE IF NOT EXISTS public_records (
    id TEXT PRIMARY KEY, company_id TEXT, company_key TEXT, kind TEXT NOT NULL DEFAULT 'layoff',
    headcount INTEGER, summary TEXT NOT NULL, source_name TEXT NOT NULL, source_url TEXT NOT NULL,
    occurred_on TEXT, added_by TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_public_records_company ON public_records (company_key, occurred_on)");

  await q(`CREATE TABLE IF NOT EXISTS circles (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS circle_members (
    circle_id TEXT NOT NULL, anon_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (circle_id, anon_key))`);

  // Contested content: a person or company can ask for a story to be reviewed.
  await q(`CREATE TABLE IF NOT EXISTS story_disputes (
    id TEXT PRIMARY KEY, story_id TEXT NOT NULL, reporter_key TEXT, role TEXT NOT NULL DEFAULT 'mentioned',  -- mentioned | company | other
    reason TEXT NOT NULL, details TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL)`);

  // ---- round 6 ----
  for (const sql of [
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS themes TEXT NOT NULL DEFAULT '[]'",       // keyword + AI-classified themes
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS noindex INTEGER NOT NULL DEFAULT 0",       // keep out of search engines
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS mod_reason TEXT",
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderated_by TEXT",
    "ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderated_at TEXT",
    "ALTER TABLE story_disputes ADD COLUMN IF NOT EXISTS resolution TEXT",
    "ALTER TABLE story_disputes ADD COLUMN IF NOT EXISTS resolved_by TEXT",
    "ALTER TABLE story_disputes ADD COLUMN IF NOT EXISTS resolved_at TEXT",
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS owner_key TEXT",
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS owner_display TEXT",
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS join_mode TEXT NOT NULL DEFAULT 'open'",    // open | request
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'", // public | unlisted
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS rules TEXT",
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",     // active | archived | suspended
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS official INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE circles ADD COLUMN IF NOT EXISTS member_cap INTEGER",
    "ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'",    // owner | mod | member
    "ALTER TABLE circle_members ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'active'",   // active | pending | muted | banned
    "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS story_id TEXT",
    "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS circle_id TEXT",
  ]) await q(sql).catch(() => {});

  await q(`CREATE TABLE IF NOT EXISTS circle_audit (
    id TEXT PRIMARY KEY, circle_id TEXT NOT NULL, actor_key TEXT, action TEXT NOT NULL, target TEXT, note TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_circle_audit ON circle_audit (circle_id, created_at DESC)");
  await q(`CREATE TABLE IF NOT EXISTS story_views (story_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (story_id, day))`);

  // Business: a company's plan (the paying entity is the company's page, never an individual's identity).
  await q(`CREATE TABLE IF NOT EXISTS company_plans (
    company_id TEXT PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'inactive',
    billing_interval TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT, current_period_end TEXT,
    updated_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS company_reps (
    company_id TEXT NOT NULL, anon_key TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'responder', created_at TEXT NOT NULL, PRIMARY KEY (company_id, anon_key))`);
  await q(`CREATE TABLE IF NOT EXISTS company_rep_invites (
    code_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_by TEXT, expires_at TEXT NOT NULL, used_at TEXT)`);

  // ---- round 12: the company suite (inbox, response workflow, alerts, employer tools) ----
  // Same boundary as everything else here: only alias handles/keys, never an account id, and never
  // a column that could carry a story author into a company-facing view.
  for (const sql of [
    "ALTER TABLE company_responses ADD COLUMN IF NOT EXISTS edited_at TEXT",
    "ALTER TABLE company_rep_invites ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'communications'",
    "ALTER TABLE company_plans ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'stripe'",   // stripe | admin_test
  ]) await q(sql).catch(() => {});

  // One row per story a company has worked on. No row = nothing done yet (derived status: new / answered).
  await q(`CREATE TABLE IF NOT EXISTS company_inbox (
    company_id TEXT NOT NULL, story_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',   -- new | in_review | escalated | closed
    priority TEXT NOT NULL DEFAULT 'normal', assigned_to TEXT, due_at TEXT, review_flag INTEGER NOT NULL DEFAULT 0, escalated INTEGER NOT NULL DEFAULT 0,
    case_no TEXT, case_status TEXT, resolution TEXT, updated_by TEXT, updated_at TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, story_id))`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS idx_company_inbox_case ON company_inbox (case_no) WHERE case_no IS NOT NULL").catch(() => {});
  await q(`CREATE TABLE IF NOT EXISTS company_notes (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, story_id TEXT NOT NULL, author_handle TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_notes_story ON company_notes (company_id, story_id, created_at)");
  await q(`CREATE TABLE IF NOT EXISTS company_drafts (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, story_id TEXT NOT NULL, author_key TEXT NOT NULL, author_handle TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',    -- draft | pending | approved | rejected | published
    approvals TEXT NOT NULL DEFAULT '[]', decision_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_drafts_story ON company_drafts (company_id, story_id)");
  await q(`CREATE TABLE IF NOT EXISTS company_templates (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS company_settings (company_id TEXT PRIMARY KEY, approval_levels INTEGER NOT NULL DEFAULT 0, sla_hours INTEGER NOT NULL DEFAULT 72, updated_at TEXT)`);

  await q(`CREATE TABLE IF NOT EXISTS company_alert_rules (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, kind TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}', notify_roles TEXT NOT NULL DEFAULT '["owner","admin"]',
    enabled INTEGER NOT NULL DEFAULT 1, last_fired_at TEXT, created_by TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_alert_rules ON company_alert_rules (company_id)");
  await q(`CREATE TABLE IF NOT EXISTS company_alert_events (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, rule_id TEXT, kind TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, story_id TEXT, created_at TEXT NOT NULL, read_at TEXT)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_alert_events ON company_alert_events (company_id, created_at DESC)");

  // Employer side: clearly company-authored content, kept apart from anonymous stories.
  await q(`CREATE TABLE IF NOT EXISTS company_faq (company_id TEXT NOT NULL, topic TEXT NOT NULL, answer TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (company_id, topic))`);
  await q(`CREATE TABLE IF NOT EXISTS company_announcements (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'update', created_by TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_announcements ON company_announcements (company_id, created_at DESC)");
  await q(`CREATE TABLE IF NOT EXISTS company_questions (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, asker_key TEXT, question TEXT NOT NULL, answer TEXT, answered_by TEXT, answered_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',      -- open | answered | hidden
    created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_questions ON company_questions (company_id, status, created_at DESC)");
  await q(`CREATE TABLE IF NOT EXISTS company_profile (company_id TEXT NOT NULL, section TEXT NOT NULL, body TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (company_id, section))`);
  await q(`CREATE TABLE IF NOT EXISTS company_showcase (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'link', title TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS company_interest (company_id TEXT NOT NULL, anon_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (company_id, anon_key))`);
  await q(`CREATE TABLE IF NOT EXISTS company_page_views (company_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (company_id, day))`);

  // Improvement and history. Snapshots are append-only so subscribing (or unsubscribing) can never rewrite the past.
  await q(`CREATE TABLE IF NOT EXISTS company_initiatives (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, title TEXT NOT NULL, theme TEXT NOT NULL, target TEXT, status TEXT NOT NULL DEFAULT 'planned',  -- planned | in_progress | done
    baseline INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS company_snapshots (company_id TEXT NOT NULL, month TEXT NOT NULL, health INTEGER, stories INTEGER NOT NULL DEFAULT 0, reply_rate INTEGER, created_at TEXT NOT NULL, PRIMARY KEY (company_id, month))`);
  await q(`CREATE TABLE IF NOT EXISTS company_plan_history (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL, source TEXT, actor TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_company_plan_history ON company_plan_history (company_id, created_at DESC)");
}
