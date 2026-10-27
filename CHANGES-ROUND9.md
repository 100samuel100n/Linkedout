# Round 9 (web + server)

## Fixed
- **Google sign-in after logout/deactivate stayed signed out.** The 5 s "is this session allowed" cache was never cleared when an account was reactivated on the native/Google/Apple paths. New `lib/session-cache.js`; deactivate, reactivate and admin enforcement now invalidate it.
- `app/admin/page.js` had a syntax error (`K.map([l, k, tone]) =>`) that would have broken the build. Fixed.

## Plan limits (admin controls everything, everything follows)
- `lib/plan-config.js`: admin overrides stored in `plan_overrides`, applied in place onto `TIERED_DAILY_LIMITS`, `MESSAGING`, `STORY_PERKS`, `PLANS`, `PLAN_COMPARISON`. Refreshed every 15 s per instance and instantly after a save.
- Admin > Billing > **Plan limits & prices**: change / reset any limit, switch or displayed price.
- `GET /api/plans`: live plans + comparison, used by the web plan page and the native plan screen.
- Price rows change what is *displayed*. The amount charged is still your Stripe prices.

## Messaging
- Stickers/GIFs (all plans), **voice notes and file sharing (OUT+ and OUT PRO)**, enforced server-side (`validateAttachment`, `POST /api/messages/upload`). Limits (voice seconds, file MB) come from the live plan config.
- Stored inside the existing encrypted message body (`\u0001` + JSON). No schema change. Attachment messages cannot be edited.
- New plan-comparison rows: Stickers and GIFs, Voice notes, File sharing.

## Push with audio
- Push broadcasts can carry a voice note / clip / song (`broadcasts.media`, `notifications.media`, created automatically). Staff upload through `POST /api/admin/broadcast-audio` (60 MB max). The push only carries a small descriptor; the app downloads the file.

## Stories
- Short share links `/s/<8 chars>` -> `/stories/<id>`, plus a share sheet.
- Admin > Stories: edit, feature/unfeature, unpublish, remove/restore, search-engine toggle, **permanent delete** (evidence files, updates, responses, reports, view history).

## Admin deletes added
Ad review queue, advertisers (with their ads), support tickets, enterprise leads, stories.

## View metrics (stored now, shown later)
- `lib/views.js`: `view_counts`, `view_daily`, `view_seen` (viewer = salted hash, de-duplicated per 30 min). Recorded server-side for posts, stories, companies, profiles; feed impressions via `POST /api/views` and `lib/impressions.js`. Nothing in the UI reads them.

## Web layout
- Small screens: Messages is in the top bar (centered), Pulse replaces it in the bottom tabs, Log out moved to the Profile page.
- Mobile keyboard: viewport `interactive-widget=resizes-content`, VisualViewport insets for iOS, focused field scrolled into view.

## Before deploying
`npm install`. New tables/columns are created on first use. Optional: `VIEW_HASH_SALT`.
