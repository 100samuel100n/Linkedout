# Round 5: LinkedOut Stories (web + native)

LinkedOut's primary object is now the **Story**: a structured first-hand account of a workplace experience.
Pulse (the old feed) is kept as the casual short-form feed at `/pulse`.

## What's new
- **Home = Stories** ("What's actually happening?"): category filters, Latest / Resonating, format filter, same ad rules as Pulse (`components/useFeedAds.js`).
- **Tell your story** (`/stories/new`): 16 formats (My Experience, I Was Laid Off, I Quit, I Was Fired, Interview, Ghosted, Salary Reality, Management, Red/Green Flag, Whistleblower, Confession, Warning Others, Am I the Only One?, Job Description vs Reality, What Wasn't in the JD). Format-specific fields, "what were you told vs what actually happened", "what do you want?" (sharing / support / advice / warn / find others / accountability), "No advice, please", real / alias / anonymous, private drafts, scheduled publishing (OUT+), receipts upload (private storage).
- **"This happened to me too"** replaces Like on Stories: same / similar, same company vs other companies, counts only, milestone notifications to the author.
- **Story page**: updates, corrections and milestones; outcome status; timeline; related stories; evidence list; company response; report/contest; track story; discuss on Pulse. Pulse posts can be turned into Stories (`/stories/new?from=<postId>`).
- **Credibility architecture**: badges say what we know, never "true" (Personal account / Evidence attached / Multiple independent reports / Publicly documented / self-declared or verified employee / Company response).
- **Privacy**: automatic server-side redaction of emails, phones, IDs, account numbers, secrets, addresses (`lib/stories/redact.js`); identity-risk warnings (OUT+) with a one-tap switch to anonymous.
- **Company page** now leads with Reality (`components/stories/CompanyReality.jsx`): counts, emerging patterns (>= 5 independent reports in 90 days), Before you join (generated from real reports), claims + Truth Gap + Reality Checks, layoffs, why people left, interview and salary reality, red/green flags, "not in the JD", Workplace Reality Index (needs >= 8 stories, methodology shown), exit-wave detection, Company Reality Timeline, right of reply. Old reviews/salaries/horror stories stay below it.
- **Layoff Tracker** (`/layoffs`): "User-reported" and "Publicly documented" strictly separated. Only staff-added public records (`POST /api/layoffs/records`, needs a source link) move something to documented.
- **Support Circles** (`/circles`), anonymous membership.
- **Reality Translators** (`/translator`): corporate / HR / job posting / meeting. Free built-in glossary for everyone; AI for any text is OUT+. Always labelled an interpretation.
- **Intelligence** (`POST /api/intelligence`): OUT+ "what people are saying", OUT PRO Company Deep Dive and Pattern Explorer. Summarises only real Stories, each point links back to them.
- **Plans**: OUT $0, OUT+ $14.99/mo or $158.29/yr, OUT PRO $34.99/mo or $369.49/yr (source: `PLANS` in `lib/tiers.js`). Annual billing via Stripe. Plan page lists only what is enforced; unbuilt rows say "Soon".
- Terms: new section 14 (stories, evidence, right of reply).

## Principles encoded
Reading stories, telling stories and seeing company patterns are free on every plan. Paid plans buy synthesis, analytics and convenience. Businesses can reply but cannot remove, edit or unmask stories. Nothing states a company did something; patterns say "N user reports mention X within the last D days".

## Setup you must do
1. Stripe: create two **annual** Prices on the existing products and set `STRIPE_PLUS_ANNUAL_PRICE_ID` and `STRIPE_PRO_ANNUAL_PRICE_ID` (see `.env.local.example`). The existing monthly Prices must be changed/replaced to $14.99 and $34.99 (Stripe Prices are immutable: create new ones and update `STRIPE_PLUS_PRICE_ID` / `STRIPE_PRO_PRICE_ID`). Existing subscribers stay on their old price until you migrate them.
2. New tables are created automatically on boot (`lib/stories/db.js`).
3. Add public layoff records as staff: `POST /api/layoffs/records` `{ companyName, summary, sourceName, sourceUrl, occurredOn, headcount }`.

## Not built yet (deliberately listed, not faked)
- Employment verification workflow (the `verified_employment` column and badge exist; nothing sets it yet).
- Admin moderation queue for `story_disputes` (reports are stored; review them in the database for now).
- Saved searches and alerts, creator analytics, exports, hosting Story rooms, Business / Business Pro / Enterprise plans (prices are defined in `BUSINESS_PLANS`; no checkout yet).
- Story receipts upload in the native app (web only), ads in the native Stories feed, the company right-of-reply UI on native.
- Identity-risk and redaction are heuristics (regex/keyword rules), not guarantees. Pattern detection is a keyword dictionary (`lib/stories/themes.js`): explainable, but it misses paraphrase.
- Not run: `npm install` / `next build` / any test (no network in this environment). Every new file parses and all imports resolve, but the app has not been executed.
