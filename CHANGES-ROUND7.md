# Round 7: native fixes, safer stories, polish

## Fixes
- **"Something went wrong" screen on native**: every stack/tab screen now sits inside its own error boundary (`components/ScreenBoundary.js`). A failing page shows "Try again" (remounts it) and "Go back"; the app never needs relaunching. Account-only screens (My stories, Alerts, Get verified, Analytics, Company console, Circle manage, Story composer) show a friendly **Log in** prompt (`components/RequireLogin.js`) instead of calling the API and failing. The root boundary's "Try again" now remounts the tree.
- **Google sign-in (native)**: the server now ends the flow with a bridge page (`lib/identity/app-return.js`) instead of a bare redirect to `linkedout://`, because Chrome on Android blocks automatic custom-scheme redirects. The app accepts the result from EITHER the in-app browser session OR the deep link, and completes a sign-in even if the app was relaunched by the link. A sign-in can't hang forever (5 min cap) and a ticket is only used once.
- **Profile photo (native)**: the server sniffs the real image type from the file bytes (wrong/empty content types no longer reject good photos), the limit is 10 MB (was 5), the app crops square at quality 0.5 and sends a correct type, and errors say what to do (HEIC needs conversion).
- **Logo (native)**: the header uses the same artwork as the website (blue door mark, navy twin in light mode) instead of a white tinted silhouette.
- **HQ avatar**: `linkedout_hq` always serves the current `/logo-mark.png` (no stale seeded upload).

## Native parity
- Pulse composer: **schedule** (Now / In 1 hour / Tonight 8pm / Tomorrow 9am / pick date & time), same server rule as web.
- Company page order matches the web: **name and summary first**, then Reality, then "Classic reviews, salaries and horror stories" (same tabs and forms).
- Layoff Tracker restyled to mirror the web page (legend cards, sections, links); "Read the stories" opens the feed filtered to layoffs.
- Story **Room** category: "Story" vibe on web and native; rooms hosted from a story show "about a story →".
- Receipts: add them **after publishing** from the story page (web and native), with clear upload errors.
- Story analytics: native **CSV/JSON export** via the share sheet.

## Web
- Sidebar nav scrolls on its own (hidden scrollbar, soft fade) so Logo, primary action and account menu stay visible. The primary action ("Tell your story" / "Post to Pulse") is now a proper full-width button that collapses to a 48px icon button on narrow rails.
- Company page body is now **server-rendered** (header, reality summary and latest stories are in the first HTML).

## Stories are no longer one-size-fits-all
All stories share a core (who, where, when, what happened, told vs actual, categories, what you want, identity, receipts) and each of the 16 formats adds its own fields. New: **risk tiers** (`storyRisk` in `lib/stories/constants.js`):
- *Standard*: normal guidance.
- *Higher care* (fired, management, red flag, confession, warning, and categories like toxic workplace, bad manager, unpaid wages): anonymous pre-selected, defamation and retaliation guidance.
- *Highest care* (whistleblower; harassment, discrimination, whistleblowing categories): anonymous pre-selected, strongest safety notes, and the **server always keeps the story out of search engines**.
The "Before you post" card in the Privacy step reflects the tier. It is guidance, not legal advice.

## Still not done (honest list)
- Detection (redaction, names, identity risk, themes) is heuristics plus optional AI tagging: much better, never perfect, and it cannot catch everything a human who knows the situation would.
- Verification by work email is automatic only when the company page has a website; otherwise the person proves control of the address and **a reviewer confirms the domain** (admin, "Employment Verification").
- Native Story Room joining opens the Vent tab rather than the exact room.
- Nothing here has been executed (no install, build, DB or device run). Expect small first-run fixes.

## Sitemap
Rules live in **`lib/seo-config.js`** (static pages, limits, priorities, never-index list). The XML is produced by `app/sitemap.js` and served at `/sitemap.xml`; `app/robots.js` serves `/robots.txt`; `public/llms.txt` is a plain file.
