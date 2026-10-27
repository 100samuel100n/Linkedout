# Round 12: Company Command Center and plan upgrade (web only)

Native app untouched. The old `/api/companies/[id]/business` route keeps its shape for it (`reps` still excludes the owner).

## What changed
**One source of truth for plans:** `lib/business-features.js`. The server enforces it (`has()`, `levelOf()`), `lib/tiers.js` derives the old flags from it, and the pre-purchase table renders it. Rows not built yet are marked **Coming soon** in the table rather than sold.

**Where to see it:** `/business` (public comparison), `/companies/[id]/dashboard` (Command Center: Reputation, Stories, Alerts, Insights, Improve, Employer, Team, Reports, Plan). `/companies/[id]/business` now redirects to the Plan tab (Stripe return URLs keep working). Public company page gets a "Company says" section.

**Server:** `lib/stories/company-metrics.js` (pure maths), `company-intel.js` (analytics), `company-alerts.js` (rules + engine), `company-suite.js` (inbox, drafts, approvals, cases, employer content, initiatives, disputes, audit), routes `api/companies/[id]/suite` and `.../official`.

**Admin:** `Companies & Orgs` rows now open a full Company record (overview, team, verification docs, billing and plan history, reputation, benchmark, stories with no authors, disputes, reports, jobs, risk signals, audit). New actions: set plan (testing), revoke verification, admin note, verify official fact, remove rep, terminate. `Users` → Plan (testing) has Business / Business Pro / Enterprise buttons: they apply to every company page the user owns.

## Privacy rules enforced in code
Companies never receive `anonymous_id`/`author_display` (verified by test: no author strings in overview, inbox, detail, CSV). Breakdowns need 5+ people (salary roles, department/location alerts, benchmarks need 5+ peer companies; salary-vs-industry needs 3+ companies). Salary shows p25-p75 and median only. Replies can be edited 24h and deleted by the company; stories can never be hidden, edited or removed by a company. Disputes require factual evidence.

## Decisions where your two lists disagreed (the table in section 51 won)
AI reply assistant at Business; tone check, similar stories, suggested actions at Pro. Approval workflow, case management and audit log at Pro (multi-level approval, escalation routing at Enterprise).

## Not built yet (shown as Coming soon)
SSO/SCIM, API, ATS/HRIS integrations, scheduled reports, custom competitor groups, AI-written insight summaries, events/AMA, newsletter, employee pulse surveys, candidate analytics/hiring funnel, job-view and follower analytics, employee advocacy, candidate hiring-experience surveys, IP/retention controls.

## Before deploying
Run `npm install && npm run build` (this environment had no network, so the Next build wasn't run; logic was tested on an in-memory SQLite harness and every JSX file parsed). New tables are created by `migrateStories()` on boot. Review: `salaryStats` ignores unreadable amounts and never converts currency.
