# Round 13: finish the company toolbox, and the Jobs ecosystem (web)

Native app untouched. Jobs were switched on in the web nav and search (`JOBS_ENABLED = true` in `components/Shell.jsx` and `app/search/page.js`).

## A. Company tools that were "Coming soon", now built
API keys + read-only API (`/api/v1/company`), outgoing webhooks (Slack/Teams/signed generic, SSRF-guarded), IP allowlist (with lock-out guard), scheduled reports (hourly scheduler + `/api/cron/company`), custom competitor group (by industry), AI leadership summary, events and AMA, followers and newsletter, anonymous pulse surveys (verified current employees only, results from 8 answers, HMAC voter hash, date-only), verified-employee advocacy count (opt-in via `POST /api/employment/advocacy`).
**Still not built (still marked "Coming soon"):** SAML/OIDC company SSO and SCIM; native Workday/Greenhouse/Lever connectors (use API + webhooks); data-retention and session-length controls; size and geography peer cuts (company size isn't collected); job-level hiring teams and bulk job import.

## B. Jobs ecosystem
**Model:** jobs belong to a company entity (`jobs.company_id`). Sources: official / community / external (external can only be set by staff). Verification: Verified, Company-associated (poster has a verified work email at the company), Community, External, Under review.
**Pages:** `/jobs` (search, filters, recommendations with match reasons, alerts), `/jobs/[id]` (rich job + "Before you apply" + apply + save/interested/report/claim), `/jobs/new` ("Who are you posting for?"), `/jobs/mine` (applications timeline, messages, interview times, anonymous feedback, saved, alerts, preferences). Company page gets "Open positions". Command Center gets **Jobs** (jobs, funnel, applicants pipeline, notes, messages, interview invitations, claim, hiring history, AI wording review).
**Rules that matter:**
* Transparency score is a ranking input (+ freshness + verification), never a filter. Missing salary lowers the score, doesn't hide the job. Nothing a company pays for changes organic rank; there is no promoted slot.
* "Before you apply" shows aggregates with sample sizes (5+ reports), never a verdict; a role-specific view needs 5+ reports about that role, otherwise it says it is showing the whole company.
* In-app applications only for official jobs (a community job has no one to receive them; those must give an apply link).
* Applications are stored with the candidate's alias key and a snapshot of only what they chose to share. Application messages are encrypted at rest with the messaging module's crypto but are **not** in the DM inbox: DMs are 1:1 consent chats between aliases; an employer is a team.
* Hiring-experience survey answers carry no application id and only the month; shown to a company from 5 answers.
* Three different reporters of a serious problem take a job out of search until staff review it. New community posts that match scam signals go to review first.
* Lifecycle: draft, review, published, paused, filled, expired, closed, withdrawn. Filled/closed/expired jobs stay viewable as history.
* Old jobs are backfilled by `runJobMaintenance()` (links to a company by name as "awaiting confirmation", never verified).

## Roles
New `recruiter` role. Permissions: jobs.post, applicants.view/manage/message, interviews.manage, hiring.insights. HR can view applicants; Analyst/Executive see hiring insights only; Communications has no applicant access.

## Not built from your Jobs spec
Promoted/featured jobs (deliberately: needs a clearly separate, labelled slot); external job aggregation/import UI; resume file upload (paste text or links today); calendar sync/ICS and automatic time-zone negotiation beyond showing times in each person's zone; "Company X is hiring" cards inside the Stories feed (the company page and job page link both ways); native app screens.

## Before deploying
`npm install && npm run build`. Set `CRON_SECRET` if you use `/api/cron/company` (the in-process scheduler also runs hourly). New tables are created by `migrateStories()` / `migrateJobs()`.
