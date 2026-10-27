# LinkedOut Admin Dashboard

Role-based staff dashboard built into the web app (`/admin`) and the native app
(`AdminHome` screens). Both talk to one API, `/api/admin/*`, so a role change
or a new section shows up in both.

## Getting in
1. Run the app once so the schema migrations apply (they run automatically — `lib/admin/schema.js`).
2. Make your first super admin: `npm run make-staff -- --email you@x.com --role super_admin`
   (use `node --env-file=.env.local scripts/make-staff.js ...` if your env isn't auto-loaded).
3. Log in normally. **Staff are redirected to `/admin` (web) / `AdminHome` (native) on login**, including
   Google/Apple sign-in and returning sessions. "Back to app" lets staff use the normal app.
4. Super admins grant further roles in **Staff Admin**.

## Roles (`lib/admin/roles.js` — the only place to edit permissions)
| Role | Can |
|---|---|
| analyst | Command Center, analytics, network, infra (read-only) |
| support | Users (incl. email/name), tickets, verification review |
| moderator | Moderation, reports, spam, DMs, rooms, search blocks; enforce (non-severe) |
| trust_safety | Everything moderator + severe enforcement (suspend/ban/lock), appeals, DMCA, companies, feed, security, break-glass view |
| verification_reviewer | Verification (incl. private documents), companies |
| ads_manager / finance | Ad review / payments + ads |
| legal | Legal requests, DMCA, audit logs, user PII |
| admin | All sections except Staff Admin |
| super_admin | Everything, incl. Staff Admin |

The server re-reads the role from the database on **every** admin request. Hiding a
menu item is UX only; the API refuses anything the role can't do.

## Privacy model (kept from your architecture)
- Moderators act on **post ids / anonymous ids**. "Warn author" / "Limit author posting" resolve the
  account server-side; the moderator never sees whose it was.
- Email / real name / phone appear only for roles with `users.pii`.
- Break-glass remains script-only (two distinct operators). The dashboard shows requests **read-only**.
- DM bodies are never decrypted in the dashboard — only metadata and reporter-submitted evidence.
- Every admin action (and every user-profile / document view) is written to `identity.staff_audit_log`.

## What enforcement actually does
Locked / suspended / banned accounts and forced password resets are treated as logged out
(`lib/session.js`, web cookie + native Bearer) and get a clear message at login; timed ones lift
automatically. Posting / replies / messaging / Vent Room / company-page restrictions are checked in the
corresponding POST routes. "Require verification" blocks posting until ID is verified. Force email/phone
verification un-verifies the flag so your existing gates apply. Removed posts disappear from feed, post
view and search. Approved-only ads are served. Blocked search terms return no results.

## New user-facing endpoints (these feed the dashboard)
`POST /api/reports` (report post/comment/room/company; Report button added to PostCard on web + native),
`POST /api/appeals` (email+password, so banned users can appeal), `POST /api/support`.

## Added in round 2
- **Admin is its own app on web.** `/admin` renders with no website chrome. Staff are sent there when they *sign in*
  (password, Google, Apple). Opening the site in another tab while signed in shows the normal website.
- **2FA (staff, TOTP).** Every staff account must enrol an authenticator app, then enter a code per session (12 h). Recovery
  codes are single-use; a super admin can reset someone's 2FA in Staff Admin. Add the key by typing it in (no QR image yet).
  Secrets are encrypted with a key derived from `IDENTITY_SIGNING_SECRET` — set a real one in production.
- **Network graph** (web): follow-network map with mass-follow flags and mutual-follow edges. Native shows the same data as a list.
- **Detail pages** for reports, appeals, DMCA notices and legal requests (web + native), with role-filtered actions.
- **Public intake:** `/legal/dmca` and `/legal/request` (no login, throttled, honeypot) feed the DMCA and Legal queues.
  Link them from your footer / policies.
- **Online / DAU / MAU** now come from a `daily_active` table and `last_seen_at`, stamped on any authenticated request (the app's
  background polling counts). Numbers begin accumulating from deploy — history before then does not exist.
- **Appeals in-app:** web login and native login show "Appeal this decision" for locked/suspended/banned accounts.
- **Likes ≠ reactions.** New `likes` table, `POST /api/posts/:id/like`, `likeCount`/`myLike` on posts. Existing ❤️ reactions on
  posts are moved into likes once at startup. Reactions keep their own counts (emoji chips + "＋"). Comments still use reactions.
- **Speed:** like / react / bookmark / repost update instantly and settle in the background; routes return small payloads and send
  notifications after responding; the session check is one cached query; the native app caches its token in memory.
- **Counts** show as 1K / 20K / 500K / 1.2M everywhere on posts.
- **Themed popups** replace browser `alert/confirm/prompt` (web) and OS `Alert` (native), including a proper Report sheet.
- **Staff gate bypass:** `super_admin` and `admin` skip email/phone verification gates, plan limits (act as Pro) and rate limits.
  A "Plan (testing)" control on a user's profile sets basic/plus/pro without payment (audit-logged). Remove `gates.bypass` from
  `lib/admin/roles.js` before opening to the public if you don't want this in production.

## Added in round 3
**Native app:** bottom tabs are now Feed · Companies · **＋** · Vent · Profile (the + is a raised round button that opens the composer from anywhere).
Header: Awards · Notifications · Upgrade · Log out. Messages moved into Profile (with unread badge). The Feed starts with a search bar (opens Search); the
"what actually happened" box is gone. Other people's profiles have a cleaner layout (avatar + actions, name, bio, stats). Settings → Account has a
profile-picture editor. Settings → Sounds & haptics has a **Haptic feedback** switch (all interaction haptics respect it).

**Google sign-in (native) — why it failed and the fix.** The old code used Google's implicit/id-token flow from the device with a device redirect. Google rejects that
for "Web" clients (the id you set), doesn't allow it for iOS/Android clients, and Expo Go's `exp://` redirect isn't allowed at all. It now goes **through your server**:
app → in-app browser → `/api/auth/google?app=1&return=…` → Google → your existing callback → one-time ticket back to the app → `/api/auth/native/exchange`.
You need only the server vars you already use for the website (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` = your `…/api/auth/google/callback`)
and `EXPO_PUBLIC_API_URL` in the app. `EXPO_PUBLIC_GOOGLE_*` are no longer used. Your phone must be able to reach that URL (use your LAN IP or a tunnel in dev).

**2FA for everyone.** Settings → Security (web) / Privacy & Verification (native): scan a QR code (or type the key), confirm a code, save 8 recovery codes. Login then asks for a
code (password, Google and Apple). Turning it off needs password + code. A staff member who enables it here uses the same code for the admin gate.
The QR encoder is dependency-free (`lib/qr.js`) and was verified by decoding output for all versions 1–10 and all 8 masks.

**Comment likes.** Same model as post likes: own table, own count, `POST /api/comments/:id/like`; existing ❤️ comment reactions are migrated once.

**Errors & offline.** People never see URLs, SQL or stack traces: network failures say "You're offline…", server errors say "Something went wrong on our side", technical-looking
messages are replaced, requests time out instead of hanging, a slim offline banner (web + native) appears and clears itself, and crashes show a calm screen
(`ErrorBoundary` on native, `app/error.js` + `global-error.js` on web). Details go to the dev console only. The admin API no longer returns raw 500 messages either.

**Admin — now a set of systems.** Sidebar groups: Overview · People · Trust & Safety · Feed & Content · Product · Advertising · Billing · Customer Support · Platform.
Every table has search, sortable columns, filter chips, pagination and CSV export; sidebar badges show queue sizes; a global search finds users, posts, companies and tickets.
- **Advertising:** advertisers; campaigns/creatives you can create, edit, schedule, budget, pause and delete; a review queue with policy rejection reasons and automated risk flags;
  impressions/clicks tracked from the real feed (web + native) with CTR, spend pacing and daily performance. Ads stop serving automatically outside their dates, over budget, or when the advertiser is suspended.
- **Customer Support:** user-facing Help & Support (web `/support`, native screen) with categories; staff queue with SLA timers, assignment, priority, status, threaded replies (the user is
  notified), private internal notes, canned responses, and first-response / resolution metrics.
- **Billing:** **Plan limits (UI vs backend)** shows what each plan page promises versus what the server enforces; subscribers, MRR/ARR/ARPU/churn, 12-month net-subscription table, billing-event log, Stripe actions (open customer, cancel at period end, refund latest payment) and promo-code creation — Stripe actions need `STRIPE_SECRET_KEY`.
- **Feed & Content:** pin any post by ID, cringe-board moderation, ad frequency + ads kill-switch, and **announcements** (banners shown at the top of the web and native feed; scheduled, targetable to free/premium).
- **Vent Rooms:** ending a room now offers "End room only" or "End and delete"; any room can be deleted.
- **DM Investigations (super admin only):** search conversations by participant, conversation ID, date range, status, reported-only or keyword, then open a conversation. A case reference and written
  reason are required for every search and every conversation opened, and each is audit-logged. Message bodies are decrypted server-side only for this view. **Update your Privacy Policy** so users know staff may review messages in abuse/legal cases.
- Create/edit forms, DM investigations, promo codes and the push/email composers are web-only; the native admin lists the new sections and supports their one-tap and reason actions.

## Added in round 4
**Messaging (admin → Messaging):** *Push Notifications* and *Email Broadcasts* share one composer and one audience builder.
- **Audience:** Everyone · Segment (plan, country, verified ID/email/phone, active in last N days, inactive N+ days, joined in last N days, staff only, open support ticket, 2FA on/off, with one-click presets) · Specific people (paste handles, emails or account IDs). A live count shows exactly how many will receive it and how many can't be reached (no device / unverified email / opted out).
- **Push:** title + message (length counters), optional link, lock-screen preview, optional copy in people's in-app notifications, **send now or schedule**, test-to-my-devices. Each recipient's own tone / sound / vibrate settings are honoured; dead devices are pruned.
- **Email:** subject, preview text, headline, body with light formatting (`## heading`, `- bullets`, `**bold**`, `[links](https://…)`, `{{firstName}}`), button, a branded template with live preview, test send, batched delivery through Resend (rate-limited, one-click `List-Unsubscribe`, per-person unsubscribe link).
- **Types:** *Announcement / offer* respects the new **Announcements & offers** setting people see in both apps (and email gets an unsubscribe link); *Service notice* (outage/security/legal) ignores it.
- **History:** status, delivered / total / failed, cancel while scheduled, "Reuse" to re-send a past one. Everything is audit-logged. Credentials/health panel at the top of each page.
- Setup values and the exact steps are in **PUSH_SETUP.md**; env placeholders are in `.env.local.example` (backend) and `.env` / `.env.example` / `eas.json` (native). `app.config.js` picks up the EAS project id and Firebase file automatically.

**App icon & launch animation:** redrawn icon (door now properly hinged and swung inward, artwork scaled to sit inside the Android safe zone, new notification glyph, web favicon/logo updated). The launch animation is a single frame-accurate timeline: door swings open → a nervous commuter ("Thrilled to announce…") → boot kick → WHAM → he tumbles toward the camera with briefcase and résumés flying → door slams → "Don't let the door hit you." Tap to skip; Reduce Motion gets a calm hold.

## Honest limits
- Not run end-to-end: no Postgres, Stripe, Google or device was available here. Everything was syntax-checked; TOTP, the QR encoder, number formatting and role logic were tested in isolation.
  Run `npm run build` and click through each flow (Google on a real phone, 2FA enrolment, ad create → feed → report, support ticket round-trip, Stripe actions in test mode) before shipping.
- Enforcement/restore can take up to 5 s to apply (session cache).
- Ad "spend" is an estimate (impressions × price per 1,000); it isn't invoicing. Impressions are counted once per card mount (native) / when 50% visible (web).
- Linking an existing account to Google from Settings isn't built (signing in with the same email links automatically).
- Staff 2FA gate is separate from user 2FA only in that staff must have it on; regular users opt in.
- Removed posts are hidden from feed, post view, search and Likes; profile pages, bookmarks and reposts of a removed post were not touched.
- Payments stay Stripe-first; "Set plan" in Subscribers is a manual override (audit-logged).
