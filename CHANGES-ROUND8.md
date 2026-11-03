# Round 8: plans, admin truthfulness, reposts, notifications, sign-in

## Plans and limits
- **Resume Roast AI**: OUT (free) has none (the server answers 403 "part of OUT+ and OUT PRO"). OUT+ = **3/day**, OUT PRO = **10/day**. Defined once in `lib/identity/rate-limit.js` (`TIERED_DAILY_LIMITS.resume_roast`).
- **No numbers in the UI.** The plan pages (web and native), the profile plan line and the limit error message no longer show daily numbers. They show relative levels (Light / Extended / Highest). The comparison table lives in `PLAN_COMPARISON` in `lib/tiers.js` and the web plan page reads it.
- **Vent Rooms**: every plan can join (`VENT_ACCESS.basic.canJoin = true`, join route, web and native screens). Starting a room is still OUT PRO.
- **Admin > Billing > "Plan limits (UI vs backend)"** (new): for every limited feature, what people see vs what the server enforces, per plan. Numbers are read live from the same tables the server enforces.
- **Admin prices fixed**: `lib/admin/systems.js` had hard-coded old prices (4.99 / 9.99). It now reads `PLANS` in `lib/tiers.js` (14.99 / 34.99), so Subscribers MRR/ARR and Revenue are correct.

## Admin
- **2FA "not implemented"** was a leftover placeholder in Security Center. Staff 2FA (TOTP) has been enforced on every admin call for a while. The panel now shows "enforced, N/M staff enrolled".
- **Live now**: grace window 90s (was 75s, one dropped heartbeat no longer flickers someone offline), logout removes the person immediately (web and app), banned/suspended accounts are excluded, the list is sorted by most recent activity, durations use the server clock, and the panel shows "reconnecting..." and a grey dot when its own feed stalls instead of a confident stale number.

## Fixes
- **Resume upload "DOMMatrix is not defined"**: caused by an unpinned `pdf-parse` (`*`) installing 2.x, which needs browser globals. Pinned to `1.1.1`, parser rewritten (`lib/resume-parse.js`), with a fallback shim for 2.x, clear messages for scanned/unreadable PDFs, and `serverExternalPackages` in `next.config.mjs`. **Run `npm install` and commit the lockfile.**
- **Reposts on Profile > Posts** now render as the full original card (author, avatar, reactions, likes, replies, bookmark, poll, media), the same as Likes and Bookmarks. The server fully hydrates the original (`attachBatchExtras`), the card shows a small "reposted" line, and actions act on the original. Quote reposts keep their embedded design. A removed original shows a short notice.
- **Notifications can be deleted** (per account only): delete one, "Clear all" / "Clear these" for the current tab. `DELETE /api/notifications/[id]`, `DELETE /api/notifications`.
- **Google token endpoint** now checks the token audience (`GOOGLE_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_NATIVE_CLIENT_ID`), requires a verified email, and applies the account-restriction gate.
- **Errors**: `ErrorNote` keeps up to two short sentences (so hints like "Upgrade to..." are not cut off) and wraps properly.
- **Dockerfile**: `npm ci || npm install` because `package-lock.json` was out of sync with `package.json`.

## Not verified
Nothing was executed (no install, build, database or device). JSX files could not be syntax-checked here; all edited plain JS files pass `node --check`.

## Follow-up: Google sign-in for previously used accounts (web and app)
Password login and the 2FA step reactivate a deactivated account; the Google/Apple paths did not, so a previously used
(deactivated) account got a session cookie that the server immediately rejected and the user stayed signed out. Admins
were unaffected because their 2FA step goes through the reactivating path. Now all Google/Apple paths reactivate, a
restricted (locked/suspended/banned) account is told why on the login page, and the callback logs what happened.
