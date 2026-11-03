// Jobs schema. Jobs belong to a company ENTITY (company_id), not a name typed into a box.
// Account-keyed things (job alerts) live in the identity store; everything else is keyed by alias, like Stories.
export async function migrateJobs(q) {
  for (const sql of [
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS department TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seniority TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employment_type TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS workplace_mode TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS office_days INTEGER",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS locations TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS currency TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_period TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bonus_equity TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS responsibilities TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preferred TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS benefits TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skills TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS hiring_process TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS screening_questions TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS application_method TEXT NOT NULL DEFAULT 'internal'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_url TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deadline TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'community'",          // official | community | external
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS verification TEXT NOT NULL DEFAULT 'community'",    // verified | associated | community | external | review
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS awaiting_company INTEGER NOT NULL DEFAULT 0", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transparency INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS views INTEGER NOT NULL DEFAULT 0", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS role_context TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visa_sponsorship INTEGER NOT NULL DEFAULT 0", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS relocation INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_by_key TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_source TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_reason TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS published_at TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS filled_at TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS closed_at TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TEXT", "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reminded_at TEXT",
  ]) await q(sql).catch(() => {});
  await q("CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company_id, status)").catch(() => {});
  await q("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, published_at)").catch(() => {});

  await q(`CREATE TABLE IF NOT EXISTS job_applications (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, company_id TEXT NOT NULL, candidate_key TEXT NOT NULL,
    snapshot TEXT NOT NULL DEFAULT '{}',          -- only what the candidate chose to share with this employer
    resume_text TEXT, cover_letter TEXT, links TEXT NOT NULL DEFAULT '[]', answers TEXT NOT NULL DEFAULT '[]',
    stage TEXT NOT NULL DEFAULT 'new', stage_history TEXT NOT NULL DEFAULT '[]', rating INTEGER,
    survey_prompted_at TEXT, survey_done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  await q("CREATE UNIQUE INDEX IF NOT EXISTS idx_job_app_unique ON job_applications (job_id, candidate_key)");
  await q("CREATE INDEX IF NOT EXISTS idx_job_app_company ON job_applications (company_id, stage)");
  await q("CREATE INDEX IF NOT EXISTS idx_job_app_candidate ON job_applications (candidate_key, created_at)");
  await q(`CREATE TABLE IF NOT EXISTS job_application_notes (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, company_id TEXT NOT NULL, author_handle TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)`);
  // Application messages reuse the messaging module's encryption at rest. They are NOT in the DM inbox: DMs are one-to-one
  // consent-based alias chats, while an employer is a team of representatives. Each thread is bound to one application.
  await q(`CREATE TABLE IF NOT EXISTS job_messages (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, sender TEXT NOT NULL, sender_handle TEXT, body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', created_at TEXT NOT NULL, read_by_candidate INTEGER NOT NULL DEFAULT 0, read_by_company INTEGER NOT NULL DEFAULT 0)`);
  await q("CREATE INDEX IF NOT EXISTS idx_job_messages ON job_messages (application_id, created_at)");
  for (const sql of ["ALTER TABLE jobs ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS audit_retention_days INTEGER", "ALTER TABLE company_peer_groups ADD COLUMN IF NOT EXISTS sizes TEXT NOT NULL DEFAULT '[]'", "ALTER TABLE company_peer_groups ADD COLUMN IF NOT EXISTS places TEXT NOT NULL DEFAULT '[]'"]) await q(sql).catch(() => {});
  // Company single sign-on (OIDC) and SCIM provisioning. The client secret is stored encrypted; the SCIM token only as a hash.
  await q(`CREATE TABLE IF NOT EXISTS company_sso (company_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, client_id TEXT NOT NULL, client_secret_enc TEXT NOT NULL, domains TEXT NOT NULL DEFAULT '[]', require_mfa INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0, session_minutes INTEGER NOT NULL DEFAULT 480, scim_hash TEXT, updated_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS job_promotions (job_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0)`);
  await q(`CREATE TABLE IF NOT EXISTS job_audit (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_job_audit ON job_audit (job_id, created_at)");
  await q(`CREATE TABLE IF NOT EXISTS company_msg_templates (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL)`);
  await q(`CREATE TABLE IF NOT EXISTS job_interviews (id TEXT PRIMARY KEY, application_id TEXT NOT NULL, company_id TEXT NOT NULL, slots TEXT NOT NULL, chosen TEXT, status TEXT NOT NULL DEFAULT 'proposed', mode TEXT, link TEXT, notes TEXT, duration_min INTEGER NOT NULL DEFAULT 45, created_by TEXT, created_at TEXT NOT NULL, reminded_at TEXT)`);
  await q(`CREATE TABLE IF NOT EXISTS job_saves (candidate_key TEXT NOT NULL, job_id TEXT NOT NULL, remind INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY (candidate_key, job_id))`);
  await q(`CREATE TABLE IF NOT EXISTS job_interest (job_id TEXT NOT NULL, candidate_key TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (job_id, candidate_key))`);
  await q(`CREATE TABLE IF NOT EXISTS job_views (job_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (job_id, day))`);
  await q(`CREATE TABLE IF NOT EXISTS job_preferences (candidate_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  // Hiring-experience survey answers carry NO application id and no date finer than the month: they can't be traced to a person or a job.
  await q(`CREATE TABLE IF NOT EXISTS hiring_surveys (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, month TEXT NOT NULL, answers TEXT NOT NULL)`);
  await q("CREATE INDEX IF NOT EXISTS idx_hiring_surveys ON hiring_surveys (company_id, month)");
}
