# Round 6: parity, circles, verification, business, SEO

## Web and native now match
Native gained: Stories feed v2 (ads, format filters, saved searches), 5-step composer with receipts (photo/PDF), Support Circles (list, create, detail, manage), My stories, Story analytics, Alerts, Get verified, full company Reality (claims + Truth Gap, flags, index, timeline, right-of-reply, intelligence), Company console, story owner controls (outcome, delete, evidence, Story Room), Layoff Tracker and Reality Translator (round 5).
**The quick "+" button now exists only on Pulse** (web and native). Pulse is a bottom tab; Stories has its own "Tell us what happened" action. Composer is retitled "New Pulse post".

## Composer
Web and native: 5 steps (Type, Basics, Details, Story, Privacy), progress bar, format cards, named-person warning with one-tap swap, redaction preview, identity risk (OUT+), keep-out-of-search-engines toggle, scheduling (OUT+), drafts.

## Circles (anyone joins; OUT+ starts 1, OUT PRO up to 5, unlisted)
Roles owner / mod / member; states active / pending / muted / banned; open or approval joining; rules; remove story from circle (story survives); transfer ownership; archive/restore; audit log. Members appear to moderators only as handles. Posting into a circle requires active membership. Staff can suspend, restore, mark official, delete from admin.

## Built this round (previously "not built")
- Employment verification: work-email code (domain only stored) or document (reviewed, then deleted). Stamps the badge on new and existing stories; "I've left" switches current to former. Admin queue "Employment Verification".
- Admin moderation: Stories, Story Reports & Contests (dismiss / remove / hide from search / ask author to edit), Support Circles, Public Records (add layoffs with source), Business Plans, Enterprise Leads, plus new KPIs and sidebar badges.
- Saved searches + alerts (OUT+ 5 / PRO 25), story-tracking notifications on updates, company alerts for Business plans.
- Creator analytics and CSV/JSON exports (OUT PRO); Story Rooms (Vent room linked to a story or circle, PRO).
- Business plans: Business $199, Business Pro $499 (monthly/annual via Stripe, webhook wired), Enterprise lead form. Insights, industry benchmark (5+ peers), export, representatives with invite codes. A plan never buys removal, hiding, editing or author identity; replying stays free for verified companies.
- Better detection: theme dictionary broadened; AI tags each story's themes after publish (when AI is configured) and the result is stored, so paraphrase is caught; redaction adds private links, IPs, handles; named-person detection.
- Prices in admin revenue now come from `PLANS` in `lib/tiers.js`; annual subscribers recorded via `accounts.premium_interval`.

## SEO / indexing
robots.txt, sitemap.xml, manifest, site-wide Organization/WebSite JSON-LD, server-rendered story pages with metadata + DiscussionForumPosting, company metadata, decoder pages (FAQ schema), Open Graph images, `X-Robots-Tag: noindex` on private areas, per-story opt-out. Read **SEO-GUIDE.md**.

## Env vars to add
`STRIPE_BUSINESS_PRICE_ID`, `STRIPE_BUSINESS_ANNUAL_PRICE_ID`, `STRIPE_BUSINESS_PRO_PRICE_ID`, `STRIPE_BUSINESS_PRO_ANNUAL_PRICE_ID`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `NEXT_PUBLIC_SOCIAL_LINKS`, `NEXT_PUBLIC_APP_URL` (must be your real domain). New tables and columns are created automatically on boot.

## Still not done / be aware
- **Nothing was executed**: no `npm install`, build, database or device run (no network here). All files parse and imports resolve. Expect a first-run fix or two, especially SQL against Postgres and Expo/native layout. Run the app and click every new screen.
- Company page body is still client-rendered (metadata is server-side).
- Native: receipts upload is photo/PDF only; no in-app CSV export; Story Room joining goes through the existing Vent tab.
- Detection is better, not perfect: AI tagging needs AI configured; name detection is heuristic; identity-risk is a warning, not a guarantee.
- Employment verification by work email only works for companies with a website on their page; others use the document route.
- Enterprise has no checkout by design (contact form + admin leads).
