# LinkedOut — Web App

A working Next.js codebase for LinkedOut. Real routes, a real (PostgreSQL)
database, a physically separated identity/content boundary, object
storage (Backblaze B2) for media/avatars/verification documents, auth
(email, Google, Apple), transactional email, rate limiting, ads, Premium
billing via Stripe, in-app notifications, a comprehensive profile/settings
system, a seamless light/dark/system theme, and a two-person break-glass
identity-resolution workflow. See "What's mocked" at the bottom for an
honest list of what still isn't production-real.

## Run it locally

```bash
npm install
cp .env.local.example .env.local   # then fill in values — see below
npm run dev
```

Then open http://linkedoutnetwork.com. Production build: `npm run build && npm run start`.

Needs a running PostgreSQL instance (`DATABASE_URL` in `.env.local`) and
Backblaze B2 credentials (`B2_*` in `.env.local`) — see
[DEPLOYMENT.md](./DEPLOYMENT.md) for provisioning both. Tables are
created automatically on first run.

## Structure

```
app/
  layout.js               root layout — Theme/Auth/Notifications/Posts providers + Shell
  theme-provider.js         client context: light/dark/system, persisted, seamless everywhere
  auth-provider.js           client context; fetches /api/auth/me, exposes user/logout
  notifications-provider.js  client context; polls /api/notifications, exposes unread count
  providers.js                client context; fetches /api/posts, exposes addPost()
  page.js                       /            Feed (ads interleaved for free accounts)
  login/page.js                  /login      Log in + Google/Apple
  signup/page.js                  /signup    Sign up (pseudonym compulsory) + Google/Apple
  forgot-password/page.js          /forgot-password   Request a reset email
  reset-password/page.js            /reset-password   Set a new password (from email link)
  verify-email/page.js               /verify-email    Confirms the emailed link
  premium/page.js                     /premium   Plans + Stripe checkout
  companies/page.js                 /companies   Company red/green flag pages
  jobs/page.js                        /jobs      Brutal Honesty job board
  vent/page.js                         /vent     Vent Sessions (live audio rooms)
  awards/page.js                        /awards  Cringe Awards leaderboard
  profile/page.js                        /profile  Overview / My Posts / Settings tabs
  globals.css                    theme CSS variables (dark + light) + animation keyframes
  api/                           see "API routes" below

components/
  Shell.jsx              top nav, route-aware tabs, notification bell, avatar, premium state
  OAuthButtons.jsx        shared Google/Apple sign-in buttons (signup + login)
  primitives.jsx         Stamp, Redacted, ReactionBar, MoodPill, PulseDot, Modal
  PostCard.jsx, AdCard.jsx, ComposerModal.jsx, ResumeRoastModal.jsx
  CompaniesList.jsx, JobCard.jsx, RoomCard.jsx, AwardCard.jsx

lib/
  theme.js        CSS-variable-backed color tokens (C), alpha() helper, font stacks
  data.js         seed content + UI config constants
  api.js          client-side fetch wrappers — nothing in the UI reads data directly
  session.js      cookie + Bearer-token session helpers used by API routes
  config.js       shared getAppUrl() helper
  stripe.js       lazy Stripe client + config getters (never throws at build time)
  email.js        lazy Resend client — logs instead of sending when unconfigured
  oauth.js        Google (implemented) + Apple (scaffolded) OAuth helpers
  avatars.js       avatar file storage on the same persistent volume as the databases
  identity/       the Identity Service — db.js, service.js, rate-limit.js, crypto.js, alias.js
  content/        the Content Service — db.js, service.js

scripts/
  break-glass-request.js   step 1/2 — file a request (any operator)
  break-glass-approve.js   step 2/2 — approve + resolve (a DIFFERENT operator)

Dockerfile, .dockerignore, fly.toml   deployment — see "Deployment" below
.env.local.example                    template for required env vars
```


## The Identity Service boundary

Two PostgreSQL schemas, not one:

- **`identity` schema** (`lib/identity/db.js`) — the PII vault. `accounts`
  (email, password hash, real name, Stripe fields), `anonymous_identities`
  (the `anonymous_id` ↔ `account_id` mapping), `break_glass_requests`,
  `audit_log`, `rate_limit_events`, `billing_events`. Nothing outside
  `lib/identity/` touches this schema.
- **`content` schema** (`lib/content/db.js`) — posts, companies, jobs,
  rooms, awards, ads. The `posts` table has an `anonymous_id` and
  `author_display` column and nothing else identity-shaped — no
  `account_id`, `email`, or `real_name` column exists in this schema at
  all.

Both connect via `DATABASE_URL` by default (see `lib/db/pg-client.js`) —
set `IDENTITY_DATABASE_URL`/`CONTENT_DATABASE_URL` instead if you want
them on physically separate Postgres instances, not just separate
schemas in one.

**How a post crosses the boundary** (`app/api/posts/route.js`): the
request needs a valid session (see "Auth: web + native" below) → the
identity service issues a short-lived **content token**
(`{ anonymousId, displayLabel, mode }`, no account id) → the post is
created in `content.db` from that token alone.

## Auth: web + native

`lib/session.js` accepts two forms of the same signed session token, both
verified with the identical `verifySession()` — neither is a "lighter"
check:

- **Web:** an httpOnly cookie, set by `createSessionCookie()`. The browser
  sends it automatically.
- **Native app** (see the sibling `linkedout-native` project): no cookie
  jar to rely on, so `/api/auth/signup` and `/api/auth/login` also return
  the raw token in the JSON body. The native app stores it itself
  (`expo-secure-store`) and sends it back as `Authorization: Bearer
  <token>`.

Verified directly: signed up via `curl`, got a token back, then created a
post and read `/api/auth/me` using *only* that Bearer token — no cookie
present at all.

| Mode | What gets stored on the post |
|---|---|
| `real` | the account's real name, directly — the poster's own choice |
| `alias` | one persistent generated pseudonym per account, reused across posts |
| `anon` | a fresh anonymous id + name, minted per post, never reused |

## Identity model: pseudonym, real name, and full anonymous

Every account chooses a **pseudonym at signup — compulsory, unique,
3-24 characters** (letters/numbers/underscores). This is the account's
default public identity everywhere in the app, and it changed how "alias"
mode works under the hood:

- **Alias mode** (the default for posting) now uses the account's own
  chosen pseudonym as the display name — not a randomly generated one like
  earlier versions of this project. `getOrCreateAlias()` in
  `lib/identity/service.js` reads `accounts.pseudonym` fresh on every call,
  so renaming your pseudonym in Settings changes your name on *future*
  alias posts immediately. It does **not** rewrite posts you've already
  made — `content.db` stores the display text as it was at post time and
  has no way to look it up again even if it wanted to (see the identity
  boundary above).
- **Real Name mode** still uses your actual real name — your own explicit,
  per-post choice, kept separate from your default public identity.
- **Full Anonymous mode** is unaffected — still mints a brand-new identity
  and display name per post, never reused, not linked to your pseudonym at
  all.

OAuth signups (Google/Apple) have no pseudonym to draw from, so one is
auto-generated the same way anonymous identities always have been
(`lib/identity/alias.js`) — change it any time from Settings.

## Profile & Settings

`/profile` has three tabs:

- **Overview** — avatar, pseudonym, bio, Premium status, Cringe History,
  salary transparency field.
- **My Posts** — every post you've made, reusing the same `PostCard`
  component as the main feed. Backed by `GET /api/profile/posts`, which
  matches by the anonymous ids your account has ever been issued (Alias
  mode) plus an exact-text match on your real name (Real Name mode) — see
  `getPostsByOwnership()` in `lib/content/service.js`. This is legitimate
  self-service data access (you asking for your own data), architecturally
  distinct from break-glass (a third party unmasking someone else) — see
  the code comment there for why that distinction matters. Full Anonymous
  posts are, correctly, not linkable back to you even here.
- **Settings** — edit pseudonym/real name/bio, upload or remove an avatar,
  appearance (theme), notifications, account security (password change,
  email verification status/resend), connected accounts (Google/Apple),
  and account deletion.

**Avatar uploads** go to the object storage public bucket (see
`lib/storage.js`) — same bucket post/comment media uses, under an
`avatars/` prefix. PNG/JPEG/WEBP only, 5MB max (`lib/avatars.js`). Not
currently attached to individual posts in the feed (posts are
anonymous/pseudonymous by design) — only the account's own profile page
shows it for now; see that file's comments for the reasoning and how to
extend it later.

**Account deletion** requires re-entering your password (skipped for
OAuth-only accounts, which have none) and removes your account, avatar,
notifications, and identity records. It does **not** retroactively delete
posts you've already made — same reasoning as the pseudonym-rename
behavior above, and the same GDPR-style limitation documented in the
architecture doc.

## Theme: light / dark / system

Switching in Settings → Appearance applies **instantly, everywhere** —
zero React re-renders required. The mechanism: `lib/theme.js`'s color
tokens are CSS custom properties (`var(--lo-ink)`, etc.), not literal hex
values; `app/globals.css` defines both palettes under `:root` (dark,
default) and `:root[data-theme="light"]`; toggling just flips that one DOM
attribute, and the browser re-resolves every CSS variable everywhere at
once. No component needed to change for this to work.

Two details worth knowing:

- A small inline script in `app/layout.js`'s `<head>` runs **before**
  React hydrates, reading the saved preference (or system preference) and
  setting `data-theme` immediately — this is what prevents a flash of the
  wrong theme on page load.
- `--lo-mustard` is deliberately **identical** in both palettes. It's used
  as a button fill paired with hardcoded dark text (`#14151A`) throughout
  the app; if mustard darkened for light-mode text contrast the way the
  other tokens do, those buttons would silently become dark-text-on-dark.
  One consistent bright mustard avoids that whole bug class. See the
  comment in `globals.css` for the same reasoning in place.

**Not done in this pass:** the native app (`linkedout-native`) doesn't
have a theme system yet — it's hardcoded to the dark palette. Mirroring
this over would mean React Native's `Appearance` API plus swapping
`lib/theme.js`'s literal hex values in that project (React Native has no
CSS custom properties), not a shared solution with the web app.

## Notifications

A minimal but real in-app notification system — not push notifications,
just an inbox behind the bell icon in the top bar (`NotificationBell` in
`Shell.jsx`), polled every 30s while logged in.

The one event that triggers a notification today: **someone reacts to
your post**. Wiring that up required solving a real architectural
tension: content.db has no `account_id` column at all (by design — see
the Identity Service boundary above), so "notify the post's owner"
needs *some* way to route from an `anonymous_id` back to an account. That
is **not** the same operation break-glass exists to gate:

- Break-glass: revealing a real identity **to a person** (a moderator, an
  investigator). Two-person control, audited, rare, deliberately slow.
- `notifyOwnerOfAnonymousId()` (`lib/identity/service.js`): routes a
  message **into that account's own private inbox**, server-side only,
  never exposed to any human, and never reveals who reacted — the
  notification just says "someone reacted." This is a completely different
  category of operation and is intentionally not gated the same way.

Verified live: account B reacting to account A's post correctly notifies
A without exposing B's identity; reacting to your own post correctly does
**not** self-notify; removing a reaction does not fire a duplicate
notification.

**Not built yet:** per-category notification preferences (the Settings
UI is honest about this — it shows what exists, not a fake toggle grid),
push notifications, and any event besides reactions (e.g. new followers,
if that concept gets added later).

## Cold start: real accounts, real content, no fakes

Companies, Jobs, Vent rooms, and the Cringe Awards used to be static seed
arrays with no submission path — realistic-looking, but nobody (including
this script) could add to them. That's no longer true. Every one of them
now has a real `POST` route, and `scripts/seed-content.js` is the actual
mechanism that gives a fresh install its starting content — the same
pattern documented in-chat earlier: Reddit's founders famously seeded
early activity by posting as different users under their own control,
phased out as real users arrived.

```bash
node scripts/seed-content.js
```

creates **21 real accounts** (via `createAccount()` — the exact function
`/api/auth/signup` calls), then, as those accounts, creates **~55 posts**
(rants, confessions, parodies, polls, questions, events), **7 companies**
with reviews/salaries/horror stories, **5 jobs**, and **6 Vent rooms**
with real joins — all through the same `createPost()` /
`createCompany()` / etc. functions the real API routes call, not
hand-inserted rows. Credentials get written to `SEED_ACCOUNTS.md`
(shared password, one line per account) so you can log in as any of them
and see the app from their point of view. Safe to run against an already-
seeded database — it skips accounts that already exist and does nothing
further if none are new.

**Every piece of content belongs to a real account now:**

- **Companies**: `POST /api/companies` starts a page; `POST /:id/review`
  (red/green flag + tag), `POST /:id/salary` (defaults to fully
  anonymous — salary is the sensitive kind of data), and
  `POST /:id/horror-story` all attribute to the submitter's real identity
  token, same as a post. `GET /:id` returns live-aggregated green/red
  flag counts and salary range — not stored numbers, computed on read.
- **Jobs**: `POST /api/jobs`. The "honesty score" shown on each card is
  genuinely derived (disclosed salary range + a substantive answer about
  why the last person left), not a fixed number. Postings with no salary
  range are actually sorted below disclosed ones, not just labeled that
  way.
- **Vent rooms**: `POST /api/rooms`, `POST /:id/join`, `POST /:id/leave`.
  Join/leave state is real and persists (a `room_participants` table,
  deduped per account) — the social/data layer is genuine. **Live audio
  is still not implemented** — joining is a real waiting room for audio
  that doesn't exist yet, and the UI says so rather than pretending.
- **Cringe Awards**: no longer a separate table. Any post can be
  nominated at creation time (a checkbox in the composer); `GET
  /api/awards` is a live query — `WHERE cringe_nominated = 1 ORDER BY
  cringe_votes DESC`. Voting is deduped per account the same way
  reactions are.

## Reactions, comments, reposts, polls — all real now

- **Reactions** are now server-deduped: a `reactions` table keyed on
  `(post_id, anon_key)` means one account can hold exactly one active
  reaction per post, enforced in the database — not just in the
  browser's local state, which is how the earlier version of this app
  worked and which meant repeatedly calling the endpoint could inflate
  counts. `anon_key` is the account's own persistent alias identity,
  reused purely as an opaque dedup key; it's never returned in any API
  response.
- **Comments** are real (`comments` table), shown/created with the same
  real/alias/anon identity choice as posts, and trigger a notification to
  the post's owner.
- **Reposts are real posts** — a new row with `repost_of` set, attributed
  to whoever reposted. That's the entire mechanism behind "shows on your
  profile": `getPostsByOwnership()` already finds every post belonging to
  your account, reposts included, no special-casing needed. Optional
  `quoteText` makes it a quote-repost.
- **Polls** have a real `poll_options`/`poll_votes` schema with the same
  per-account dedup as reactions — switching your vote updates counts
  correctly, voting twice doesn't. Multi-select polls are schema-ready
  (`poll_multi` column) but not exposed in the UI yet — see "What's
  mocked."

## Verification: email, phone, government ID, business, professional

Five verification types, three different honesty levels:

- **Email**: token-link, as before.
- **Phone** (optional): a 6-digit SMS code flow generated and checked in our own database, delivered by Telnyx (hashed at rest, 10-minute expiry, 5 guesses, auto-deleted, with per-account/number/IP/country fraud limits)
  (`lib/sms.js`, same graceful-fallback pattern as email — logs the code
  instead of sending when unconfigured), rate-limited attempts, 10-minute
  expiry.
- **Government ID / Business / Professional**: a **real manual-review
  workflow**, not an instant fake approval. Submit supporting text via
  `POST /api/verification`; it sits `pending` until an operator runs
  `node scripts/review-verification.js --id <id> --decision approved
  --reviewed-by "<name>"` (mirrors the break-glass script's discipline —
  see below). Automated instant verification would need a real KYC
  vendor (Persona, Stripe Identity, etc.) — not integrated here, and
  faking an instant "verified" badge would be worse than not having the
  feature, so this is the honest version until one is.

## Badges (gamification)

A `badge_defs` catalog + `account_badges` table. `checkAndAwardBadges()`
runs after actions that could newly qualify an account (posting,
commenting, reposting, verifying email/phone, going Premium, starting a
company, hitting #1 on Cringe Awards) and is idempotent — safe to call
on every relevant action without double-awarding. Earning one creates a
real notification too.

## Search

`GET /api/search?q=` — one query, five categories (posts, people,
companies, jobs, rooms), plain SQL `LIKE` matching. `/search` in the nav
bar. Not a ranked/relevance search engine, not fed into any
recommendation system — a straightforward keyword lookup, consistent
with "no algorithmic anything" elsewhere in this app.

## Email notifications

Every in-app notification (reaction, comment, repost, badge, verification
decision) now also fires an email via `sendNotificationEmail()` in
`lib/email.js` — same graceful "logs instead of sending" fallback as
every other Resend-backed email. It's deliberately **fire-and-forget**:
`createNotification()` doesn't await the email send, so a Resend hiccup
can never block or fail the in-app notification that triggered it.
**Not built:** per-category email preferences or digest batching — every
notification fires its own email immediately when Resend is configured.
A real product would batch these and let people turn categories off.



1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   **Create Credentials → OAuth client ID** → Application type: **Web application**.
2. Add an authorized redirect URI:
   `{NEXT_PUBLIC_APP_URL}/api/auth/google/callback`
   (e.g. `http://linkedoutnetwork.com/api/auth/google/callback` for local dev).
3. Copy the Client ID and Client Secret into `.env.local`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Restart the dev server. The "Continue with Google" button on
   `/login` and `/signup` will now do a real redirect instead of
   returning a "not configured" message.

Implementation notes: uses the standard authorization-code flow
(`lib/oauth.js`), validates the returned ID token via Google's own
`tokeninfo` endpoint (simpler than implementing local JWKS/RS256
verification, and still correct since the validation call goes straight
to Google over TLS), and checks the token audience matches your client ID
before trusting it. **Not tested against Google's real servers in this
environment** — no network access to `accounts.google.com` from here, the
same limitation Stripe's checkout flow has. The code is written to
Google's documented API contract; test it yourself with real credentials
before relying on it.

## Apple Sign In

Scaffolded to the same shape as Google (`isAppleConfigured()`,
`buildAppleAuthUrl()`, `exchangeAppleCode()` in `lib/oauth.js`,
`/api/auth/apple` + `/api/auth/apple/callback` routes) but **genuinely
cannot be tested without**:

1. A paid **Apple Developer Program membership** ($99/year).
2. A **Services ID** (your `APPLE_CLIENT_ID`) and a **Sign in with Apple
   key** (a downloaded `.p8` file) from developer.apple.com.
3. Your **Team ID** and the key's **Key ID**.
4. The private key's contents, PEM-formatted, as `APPLE_PRIVATE_KEY`.

None of that exists here. One specific gap flagged directly in the code
(`lib/oauth.js`): Apple's ID token signature is currently decoded **without
verification** — a real implementation needs to fetch Apple's JWKS
(`https://appleid.apple.com/auth/keys`) and verify the RS256 signature
locally before trusting the payload. This is marked clearly in the source
so it's never mistaken for finished, production-ready code. Until
`APPLE_CLIENT_ID`/`APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` are
all set, `isAppleConfigured()` is false and the button returns the same
graceful "not configured" response the other unconfigured integrations do.

## Email setup (Resend)

1. [resend.com](https://resend.com) → API Keys → create one → put it in
   `.env.local` as `RESEND_API_KEY`.
2. Verify a sending domain in Resend, then set `RESEND_FROM_EMAIL` to an
   address on it (e.g. `LinkedOut <noreply@yourdomain.com>`). For quick
   testing without your own domain, Resend's own `onboarding@resend.dev`
   works but is rate-limited and not meant for real use.
3. Restart the dev server.

Three emails are wired up (`lib/email.js`): a welcome email on signup, an
email-verification link (`/verify-email?token=...`, 24h expiry), and a
password-reset link (`/reset-password?token=...`, 1h expiry, single-use).
**Without real credentials, nothing breaks** — every send call logs what
*would* have gone out to the server console instead, so signup and
password reset both work end to end in local dev without a Resend
account. Verified live: requested a password reset, grabbed the real
token straight from the database (simulating clicking the emailed link),
completed the reset, confirmed the old password stops working and the new
one works, confirmed the same token can't be reused a second time.

## Rate limiting

Enforced at the identity layer (`lib/identity/rate-limit.js`), *before* a
content token is ever issued or a reaction/vote is recorded — so the
content service never needs to know limits exist. Rolling window, not a
fixed bucket:

| Action | Limit | Requires login |
|---|---|---|
| create a post | 5 per 10 min | yes |
| react to a post | 30 per 1 min | yes |
| vote on an award | 20 per 24 hr | yes |

Reactions and votes now require a session (they didn't before this pass —
tightened to match how the rate limiter needs a real account to key off
of). Hitting a limit returns `429` with a `Retry-After` header and a
plain-language message; the client shows it inline and rolls back its
optimistic UI update. Limits are defined in one place
(`RATE_LIMITS` in `lib/identity/rate-limit.js`) — they're starting points,
not measured thresholds; tune them once there's real traffic data.

**Multi-instance safe**: counters live in Postgres (`rate_limit_events`,
in the `identity` schema — see `lib/identity/rate-limit.js`), not
in-memory, so this works correctly across more than one running instance
already — no separate shared store (Redis/Upstash) needed for this
particular piece. See architecture doc Section 5 for the broader
abuse-prevention picture
(sybil resistance, brigading detection) that isn't built yet either.

## Break-glass: two-person authorization

Resolving an `anonymous_id` back to a real account is now a two-step
process across two *different* operators — no single person, and no HTTP
route, can do it alone.

```bash
# Step 1 — anyone can file a request. Does NOT resolve anything yet.
npm run break-glass:request -- --anonymous-id <id> --reason "..." --requested-by "alice"

# Step 2 — a DIFFERENT operator approves it. This is when the lookup happens.
npm run break-glass:approve -- --request-id <id-from-step-1> --approved-by "bob"
```

Enforced by `lib/identity/service.js`:
- **Different operator** — `approveBreakGlass` rejects if `approvedBy`
  matches `requestedBy` (case-insensitive).
- **Expiry** — requests expire 24 hours after filing (`BREAK_GLASS_EXPIRY_MS`),
  so a forgotten request can't be approved months later against a case
  nobody remembers.
- **One-shot** — approving a request marks it `resolved`; approving the
  same request id twice fails with `NOT_PENDING`.
- **Full audit trail** — every successful resolution writes a permanent
  `audit_log` row with the reason, requester, and approver.

**What's still not real:** in an actual deployment, steps 1 and 2 would go
through something with real operator identity (SSO-backed internal tool,
Slack approval workflow, PagerDuty) rather than a free-text
`--requested-by` string anyone could type. The two-command split enforces
the *shape* of two-person authorization; it doesn't yet verify that "alice"
and "bob" are who they claim to be.

## Stripe setup

Test mode, end to end:

1. Create a [Stripe account](https://dashboard.stripe.com) (or use an
   existing one) and switch to **test mode**.
2. **Product Catalog** → create a product ("LinkedOut Premium") with a
   recurring monthly price. Copy the Price ID (`price_...`) into
   `STRIPE_PRICE_ID`.
3. **Developers → API keys** → copy the test **Secret key**
   (`sk_test_...`) into `STRIPE_SECRET_KEY`.
4. For local webhook testing, install the
   [Stripe CLI](https://docs.stripe.com/stripe-cli) and run:
   ```bash
   stripe listen --forward-to linkedoutnetwork.com/api/stripe/webhook
   ```
   It prints a webhook signing secret (`whsec_...`) — put that in
   `STRIPE_WEBHOOK_SECRET`. (For a real deployment, create the webhook
   endpoint in the Dashboard instead, pointed at your real domain, and use
   the signing secret it gives you.)
5. Enable these events on the webhook endpoint: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
6. Restart `npm run dev`. `/premium` will now show a real "Upgrade to
   Premium" button instead of the demo toggle.

**Design point worth calling out:** `is_premium` is set in exactly one
place — `applyStripeSubscriptionEvent()`, called only from
`app/api/stripe/webhook/route.js`, only after Stripe confirms a
subscription is `active` or `trialing`. `/api/stripe/checkout` only ever
*creates a Checkout Session*; it never flips the flag itself. That's the
difference between "the UI shows Premium" and "someone actually paid."

**Until you add real keys:** `/api/stripe/status` reports
`{ configured: false }`, `/premium` falls back to a demo upgrade/downgrade
toggle (flips the flag directly, logs a `billing_events` row, no charge),
and `/api/stripe/checkout` returns a clean `503` with an explanatory
message rather than crashing.

## Deployment

**Fastest way to see it right now:** `npm run dev` and open `linkedoutnetwork.com` —
no deployment needed for that. Everything below is for a real, public URL.

State lives in PostgreSQL (`lib/db/pg-client.js`) and Backblaze B2 object
storage (`lib/storage.js`) — both external to the app process, so more
than one instance can safely run against the same database/buckets, and
there's no local volume to manage.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full walkthrough:
provisioning Postgres, setting up Backblaze B2 (public bucket for
media/avatars, private bucket + signed URLs for verification documents),
step-by-step guides for both Railway and Fly.io, and pointing a Namecheap
domain at either one.




## API routes

| Route | Method | Does |
|---|---|---|
| `/api/auth/signup` | POST | create an account (pseudonym compulsory), start a session, send welcome + verification email |
| `/api/auth/login` | POST | verify credentials, start a session |
| `/api/auth/logout` | POST | clear the session |
| `/api/auth/me` | GET | current session's account — full profile shape, same as `/api/profile` |
| `/api/auth/google`, `/api/auth/google/callback` | GET | Google OAuth start + callback — web flow (redirect) |
| `/api/auth/google/token` | POST | Google OAuth for native — verifies an id_token the mobile app already obtained (see linkedout-native) |
| `/api/auth/apple`, `/api/auth/apple/callback` | GET / POST | Apple OAuth start + callback (form_post) — web flow (redirect) |
| `/api/auth/apple/token` | POST | Apple Sign In for native — verifies an identityToken from expo-apple-authentication |
| `/api/auth/verify-email` | POST | confirms an emailed verification token |
| `/api/auth/resend-verification` | POST | requires login; re-sends the verification email |
| `/api/auth/request-password-reset` | POST | always returns the same generic response (no email enumeration) |
| `/api/auth/reset-password` | POST | consumes a reset token, sets a new password |
| `/api/auth/change-password` | POST | requires login + current password |
| `/api/profile` | GET / PATCH | fetch or update pseudonym/real name/bio/country/account type/interests |
| `/api/profile/avatar` | POST / DELETE | upload (multipart) or remove your avatar |
| `/api/profile/avatar/:accountId` | GET | serves an avatar image |
| `/api/profile/posts` | GET | your own post history, reposts included (self-service, not break-glass) |
| `/api/profile/delete` | POST | permanently deletes your account (password-confirmed) |
| `/api/auth/phone/request` | POST | sends a 6-digit SMS verification code (Telnyx; fraud-checked) |
| `/api/auth/phone/confirm` | POST | confirms the code, marks phone verified |
| `/api/verification` | GET / POST | your verification requests / submit a new government-ID/business/professional request |
| `/api/notifications` | GET | your notifications + unread count |
| `/api/notifications/:id/read` | POST | mark one notification read |
| `/api/notifications/read-all` | POST | mark all read |
| `/api/posts` | GET / POST | list / create a post (multipart — supports a media attachment) — POST requires login, rate-limited |
| `/api/posts/:id/react` | POST | toggle a reaction — real per-account dedup, notifies the post's owner |
| `/api/posts/:id/comments` | GET / POST | list / add a comment — notifies the post's owner |
| `/api/posts/:id/repost` | POST | repost (optionally with quote text) — a real post, shows on your profile |
| `/api/posts/:id/poll-vote` | POST | vote on a poll — deduped per account |
| `/api/posts/:id/cringe-vote` | POST | vote in the Cringe Awards — deduped, awards the #1 badge |
| `/api/posts/:id/pin` | POST | pin/unpin — unpins any other post of yours automatically |
| `/api/media/:postId` | GET | serves a post's attached image/video/audio/document |
| `/api/companies` | GET / POST | list companies / start a new company page |
| `/api/companies/:id` | GET | full detail — tags, salary aggregate, horror stories |
| `/api/companies/:id/review` | POST | submit a red/green flag |
| `/api/companies/:id/salary` | POST | submit a salary (defaults to fully anonymous) |
| `/api/companies/:id/horror-story` | POST | submit an interview horror story |
| `/api/jobs` | GET / POST | list jobs (disclosed-salary ones sorted first) / post one |
| `/api/rooms` | GET / POST | list Vent rooms / start one |
| `/api/rooms/:id/join`, `/:id/leave` | POST | real join/leave tracking (no live audio yet) |
| `/api/awards` | GET | Cringe Awards leaderboard — a live ranked query over nominated posts |
| `/api/search` | GET | `?q=` — posts, people, companies, jobs, rooms |
| `/api/ads` | GET | list Sponsored Roast ad creatives |
| `/api/stripe/status` | GET | whether real Stripe checkout is available |
| `/api/stripe/checkout` | POST | creates a Checkout Session, returns its URL |
| `/api/stripe/portal` | POST | creates a Billing Portal session (manage/cancel) |
| `/api/stripe/webhook` | POST | Stripe → app; the only place `is_premium` is set from real payment |
| `/api/resume-roast` | POST | returns a generated resume roast (simulated) |

## Ads & Premium

- **Ads don't require a recommendation algorithm.** The feed stays
  chronological — ad insertion in `app/page.js` is "every 4th post, if not
  Premium," not personalized ranking.
- **"Sponsored Roasts," not conventional ads** — creatives (`lib/data.js`
  → `ADS`) are written in the same self-deprecating voice as the rest of
  the app, always labeled "Sponsored — self-aware," with a direct "remove
  ads" link to `/premium`.
- **Premium status lives in `identity.db`**, not `content.db` — it's
  account metadata, not anonymous content.

## Design system

Colors and fonts live in `lib/theme.js` as a plain JS object (`C`):

- `ink` / `surface` / `surface2` / `line` — the near-black "leaked memo" shell
- `mustard` — primary accent (stamps, highlights, active tab)
- `flag` / `green` — red-flag / green-flag semantics
- `paper` / `corpblue` — redacted-document paper accent and "drained
  corporate blue" used to mock corporate-speak

Tailwind handles layout/spacing/flex; inline `style` handles anything
palette-driven. Keyframes `lo-pulse` (live indicators) and `lo-fade-up`
(resume-roast reveal) live in `globals.css`.

## What's mocked (honestly, and what's next)

- **Storage** — real PostgreSQL (`lib/db/pg-client.js`, `lib/identity/db.js`,
  `lib/content/db.js`) and real object storage (Backblaze B2, via
  `lib/storage.js`) — post/comment media and avatars in a public bucket,
  verification documents in a private bucket served only via short-lived
  signed URLs. No local files, no in-memory arrays. See DEPLOYMENT.md for
  provisioning both.
- **Deployment** — Dockerfile, `.dockerignore`, `fly.toml`, and
  DEPLOYMENT.md (Railway + Fly.io + custom domain) exist and the
  underlying standalone build was tested end to end, but `docker build`
  itself hasn't been run in this environment (no Docker daemon here) — see
  DEPLOYMENT.md for the exact commands to verify it yourself before
  trusting it in production.
- **Break-glass operator identity isn't verified** — see above; the
  two-person *shape* is enforced, real operator auth isn't.
- **Content tokens** are short-lived (5 min) but not tracked as
  single-use — a leaked token is valid for its window. A production
  version would track spent token IDs.
- **Vent Sessions** — the host (creator) controls everything: give/take
  the mic, mute everyone, remove and ban people, lock the session, end it
  for all, then delete it. Host actions are enforced on the LiveKit server
  as well as in the database (`lib/livekit.js`). Audio uses echo
  cancellation, noise suppression and auto gain on both platforms. Real
  two-person calls still need testing against your own LiveKit project.
- **Government ID / Business / Professional**: a **real manual-review
  workflow**, not an instant fake approval. Submit supporting text via
  `POST /api/verification`; it sits `pending` until an operator runs
  `node scripts/review-verification.js --id <id> --decision approved
  --reviewed-by "<name>"` (mirrors the break-glass script's discipline —
  see below). Automated instant verification would need a real KYC
  vendor (Persona, Stripe Identity, etc.) — not integrated here, and
  faking an instant "verified" badge would be worse than not having the
  feature, so this is the honest version until one is.

## Badges (gamification)

A `badge_defs` catalog + `account_badges` table. `checkAndAwardBadges()`
runs after actions that could newly qualify an account (posting,
commenting, reposting, verifying email/phone, going Premium, starting a
company, hitting #1 on Cringe Awards) and is idempotent — safe to call
on every relevant action without double-awarding. Earning one creates a
real notification too.

## Search

`GET /api/search?q=` — one query, five categories (posts, people,
companies, jobs, rooms), plain SQL `LIKE` matching. `/search` in the nav
bar. Not a ranked/relevance search engine, not fed into any
recommendation system — a straightforward keyword lookup, consistent
with "no algorithmic anything" elsewhere in this app.

## Email notifications

Every in-app notification (reaction, comment, repost, badge, verification
decision) now also fires an email via `sendNotificationEmail()` in
`lib/email.js` — same graceful "logs instead of sending" fallback as
every other Resend-backed email. It's deliberately **fire-and-forget**:
`createNotification()` doesn't await the email send, so a Resend hiccup
can never block or fail the in-app notification that triggered it.
**Not built:** per-category email preferences or digest batching — every
notification fires its own email immediately when Resend is configured.
A real product would batch these and let people turn categories off.



1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   **Create Credentials → OAuth client ID** → Application type: **Web application**.
2. Add an authorized redirect URI:
   `{NEXT_PUBLIC_APP_URL}/api/auth/google/callback`
   (e.g. `http://linkedoutnetwork.com/api/auth/google/callback` for local dev).
3. Copy the Client ID and Client Secret into `.env.local`
   (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Restart the dev server. The "Continue with Google" button on
   `/login` and `/signup` will now do a real redirect instead of
   returning a "not configured" message.

Implementation notes: uses the standard authorization-code flow
(`lib/oauth.js`), validates the returned ID token via Google's own
`tokeninfo` endpoint (simpler than implementing local JWKS/RS256
verification, and still correct since the validation call goes straight
to Google over TLS), and checks the token audience matches your client ID
before trusting it. **Not tested against Google's real servers in this
environment** — no network access to `accounts.google.com` from here, the
same limitation Stripe's checkout flow has. The code is written to
Google's documented API contract; test it yourself with real credentials
before relying on it.

## Apple Sign In

Scaffolded to the same shape as Google (`isAppleConfigured()`,
`buildAppleAuthUrl()`, `exchangeAppleCode()` in `lib/oauth.js`,
`/api/auth/apple` + `/api/auth/apple/callback` routes) but **genuinely
cannot be tested without**:

1. A paid **Apple Developer Program membership** ($99/year).
2. A **Services ID** (your `APPLE_CLIENT_ID`) and a **Sign in with Apple
   key** (a downloaded `.p8` file) from developer.apple.com.
3. Your **Team ID** and the key's **Key ID**.
4. The private key's contents, PEM-formatted, as `APPLE_PRIVATE_KEY`.

None of that exists here. One specific gap flagged directly in the code
(`lib/oauth.js`): Apple's ID token signature is currently decoded **without
verification** — a real implementation needs to fetch Apple's JWKS
(`https://appleid.apple.com/auth/keys`) and verify the RS256 signature
locally before trusting the payload. This is marked clearly in the source
so it's never mistaken for finished, production-ready code. Until
`APPLE_CLIENT_ID`/`APPLE_TEAM_ID`/`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY` are
all set, `isAppleConfigured()` is false and the button returns the same
graceful "not configured" response the other unconfigured integrations do.

## Email setup (Resend)

1. [resend.com](https://resend.com) → API Keys → create one → put it in
   `.env.local` as `RESEND_API_KEY`.
2. Verify a sending domain in Resend, then set `RESEND_FROM_EMAIL` to an
   address on it (e.g. `LinkedOut <noreply@yourdomain.com>`). For quick
   testing without your own domain, Resend's own `onboarding@resend.dev`
   works but is rate-limited and not meant for real use.
3. Restart the dev server.

Three emails are wired up (`lib/email.js`): a welcome email on signup, an
email-verification link (`/verify-email?token=...`, 24h expiry), and a
password-reset link (`/reset-password?token=...`, 1h expiry, single-use).
**Without real credentials, nothing breaks** — every send call logs what
*would* have gone out to the server console instead, so signup and
password reset both work end to end in local dev without a Resend
account. Verified live: requested a password reset, grabbed the real
token straight from the database (simulating clicking the emailed link),
completed the reset, confirmed the old password stops working and the new
one works, confirmed the same token can't be reused a second time.

## Rate limiting

Enforced at the identity layer (`lib/identity/rate-limit.js`), *before* a
content token is ever issued or a reaction/vote is recorded — so the
content service never needs to know limits exist. Rolling window, not a
fixed bucket:

| Action | Limit | Requires login |
|---|---|---|
| create a post | 5 per 10 min | yes |
| react to a post | 30 per 1 min | yes |
| vote on an award | 20 per 24 hr | yes |

Reactions and votes now require a session (they didn't before this pass —
tightened to match how the rate limiter needs a real account to key off
of). Hitting a limit returns `429` with a `Retry-After` header and a
plain-language message; the client shows it inline and rolls back its
optimistic UI update. Limits are defined in one place
(`RATE_LIMITS` in `lib/identity/rate-limit.js`) — they're starting points,
not measured thresholds; tune them once there's real traffic data.

**Multi-instance safe**: counters live in Postgres (`rate_limit_events`,
in the `identity` schema — see `lib/identity/rate-limit.js`), not
in-memory, so this works correctly across more than one running instance
already — no separate shared store (Redis/Upstash) needed for this
particular piece. See architecture doc Section 5 for the broader
abuse-prevention picture
(sybil resistance, brigading detection) that isn't built yet either.

## Break-glass: two-person authorization

Resolving an `anonymous_id` back to a real account is now a two-step
process across two *different* operators — no single person, and no HTTP
route, can do it alone.

```bash
# Step 1 — anyone can file a request. Does NOT resolve anything yet.
npm run break-glass:request -- --anonymous-id <id> --reason "..." --requested-by "alice"

# Step 2 — a DIFFERENT operator approves it. This is when the lookup happens.
npm run break-glass:approve -- --request-id <id-from-step-1> --approved-by "bob"
```

Enforced by `lib/identity/service.js`:
- **Different operator** — `approveBreakGlass` rejects if `approvedBy`
  matches `requestedBy` (case-insensitive).
- **Expiry** — requests expire 24 hours after filing (`BREAK_GLASS_EXPIRY_MS`),
  so a forgotten request can't be approved months later against a case
  nobody remembers.
- **One-shot** — approving a request marks it `resolved`; approving the
  same request id twice fails with `NOT_PENDING`.
- **Full audit trail** — every successful resolution writes a permanent
  `audit_log` row with the reason, requester, and approver.

**What's still not real:** in an actual deployment, steps 1 and 2 would go
through something with real operator identity (SSO-backed internal tool,
Slack approval workflow, PagerDuty) rather than a free-text
`--requested-by` string anyone could type. The two-command split enforces
the *shape* of two-person authorization; it doesn't yet verify that "alice"
and "bob" are who they claim to be.

## Stripe setup

Test mode, end to end:

1. Create a [Stripe account](https://dashboard.stripe.com) (or use an
   existing one) and switch to **test mode**.
2. **Product Catalog** → create a product ("LinkedOut Premium") with a
   recurring monthly price. Copy the Price ID (`price_...`) into
   `STRIPE_PRICE_ID`.
3. **Developers → API keys** → copy the test **Secret key**
   (`sk_test_...`) into `STRIPE_SECRET_KEY`.
4. For local webhook testing, install the
   [Stripe CLI](https://docs.stripe.com/stripe-cli) and run:
   ```bash
   stripe listen --forward-to linkedoutnetwork.com/api/stripe/webhook
   ```
   It prints a webhook signing secret (`whsec_...`) — put that in
   `STRIPE_WEBHOOK_SECRET`. (For a real deployment, create the webhook
   endpoint in the Dashboard instead, pointed at your real domain, and use
   the signing secret it gives you.)
5. Enable these events on the webhook endpoint: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`.
6. Restart `npm run dev`. `/premium` will now show a real "Upgrade to
   Premium" button instead of the demo toggle.

**Design point worth calling out:** `is_premium` is set in exactly one
place — `applyStripeSubscriptionEvent()`, called only from
`app/api/stripe/webhook/route.js`, only after Stripe confirms a
subscription is `active` or `trialing`. `/api/stripe/checkout` only ever
*creates a Checkout Session*; it never flips the flag itself. That's the
difference between "the UI shows Premium" and "someone actually paid."

**Until you add real keys:** `/api/stripe/status` reports
`{ configured: false }`, `/premium` falls back to a demo upgrade/downgrade
toggle (flips the flag directly, logs a `billing_events` row, no charge),
and `/api/stripe/checkout` returns a clean `503` with an explanatory
message rather than crashing.

## Deployment

**Fastest way to see it right now:** `npm run dev` and open `linkedoutnetwork.com` —
no deployment needed for that. Everything below is for a real, public URL.

State lives in PostgreSQL (`lib/db/pg-client.js`) and Backblaze B2 object
storage (`lib/storage.js`) — both external to the app process, so more
than one instance can safely run against the same database/buckets, and
there's no local volume to manage.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full walkthrough:
provisioning Postgres, setting up Backblaze B2 (public bucket for
media/avatars, private bucket + signed URLs for verification documents),
step-by-step guides for both Railway and Fly.io, and pointing a Namecheap
domain at either one.




## API routes

| Route | Method | Does |
|---|---|---|
| `/api/auth/signup` | POST | create an account (pseudonym compulsory), start a session, send welcome + verification email |
| `/api/auth/login` | POST | verify credentials, start a session |
| `/api/auth/logout` | POST | clear the session |
| `/api/auth/me` | GET | current session's account — full profile shape, same as `/api/profile` |
| `/api/auth/google`, `/api/auth/google/callback` | GET | Google OAuth start + callback — web flow (redirect) |
| `/api/auth/google/token` | POST | Google OAuth for native — verifies an id_token the mobile app already obtained (see linkedout-native) |
| `/api/auth/apple`, `/api/auth/apple/callback` | GET / POST | Apple OAuth start + callback (form_post) — web flow (redirect) |
| `/api/auth/apple/token` | POST | Apple Sign In for native — verifies an identityToken from expo-apple-authentication |
| `/api/auth/verify-email` | POST | confirms an emailed verification token |
| `/api/auth/resend-verification` | POST | requires login; re-sends the verification email |
| `/api/auth/request-password-reset` | POST | always returns the same generic response (no email enumeration) |
| `/api/auth/reset-password` | POST | consumes a reset token, sets a new password |
| `/api/auth/change-password` | POST | requires login + current password |
| `/api/profile` | GET / PATCH | fetch or update pseudonym/real name/bio/country/account type/interests |
| `/api/profile/avatar` | POST / DELETE | upload (multipart) or remove your avatar |
| `/api/profile/avatar/:accountId` | GET | serves an avatar image |
| `/api/profile/posts` | GET | your own post history, reposts included (self-service, not break-glass) |
| `/api/profile/delete` | POST | permanently deletes your account (password-confirmed) |
| `/api/auth/phone/request` | POST | sends a 6-digit SMS verification code (Telnyx; fraud-checked) |
| `/api/auth/phone/confirm` | POST | confirms the code, marks phone verified |
| `/api/verification` | GET / POST | your verification requests / submit a new government-ID/business/professional request |
| `/api/notifications` | GET | your notifications + unread count |
| `/api/notifications/:id/read` | POST | mark one notification read |
| `/api/notifications/read-all` | POST | mark all read |
| `/api/posts` | GET / POST | list / create a post (multipart — supports a media attachment) — POST requires login, rate-limited |
| `/api/posts/:id/react` | POST | toggle a reaction — real per-account dedup, notifies the post's owner |
| `/api/posts/:id/comments` | GET / POST | list / add a comment — notifies the post's owner |
| `/api/posts/:id/repost` | POST | repost (optionally with quote text) — a real post, shows on your profile |
| `/api/posts/:id/poll-vote` | POST | vote on a poll — deduped per account |
| `/api/posts/:id/cringe-vote` | POST | vote in the Cringe Awards — deduped, awards the #1 badge |
| `/api/posts/:id/pin` | POST | pin/unpin — unpins any other post of yours automatically |
| `/api/media/:postId` | GET | serves a post's attached image/video/audio/document |
| `/api/companies` | GET / POST | list companies / start a new company page |
| `/api/companies/:id` | GET | full detail — tags, salary aggregate, horror stories |
| `/api/companies/:id/review` | POST | submit a red/green flag |
| `/api/companies/:id/salary` | POST | submit a salary (defaults to fully anonymous) |
| `/api/companies/:id/horror-story` | POST | submit an interview horror story |
| `/api/jobs` | GET / POST | list jobs (disclosed-salary ones sorted first) / post one |
| `/api/rooms` | GET / POST | list Vent rooms / start one |
| `/api/rooms/:id/join`, `/:id/leave` | POST | real join/leave tracking (no live audio yet) |
| `/api/awards` | GET | Cringe Awards leaderboard — a live ranked query over nominated posts |
| `/api/search` | GET | `?q=` — posts, people, companies, jobs, rooms |
| `/api/ads` | GET | list Sponsored Roast ad creatives |
| `/api/stripe/status` | GET | whether real Stripe checkout is available |
| `/api/stripe/checkout` | POST | creates a Checkout Session, returns its URL |
| `/api/stripe/portal` | POST | creates a Billing Portal session (manage/cancel) |
| `/api/stripe/webhook` | POST | Stripe → app; the only place `is_premium` is set from real payment |
| `/api/resume-roast` | POST | returns a generated resume roast (simulated) |

## Ads & Premium

- **Ads don't require a recommendation algorithm.** The feed stays
  chronological — ad insertion in `app/page.js` is "every 4th post, if not
  Premium," not personalized ranking.
- **"Sponsored Roasts," not conventional ads** — creatives (`lib/data.js`
  → `ADS`) are written in the same self-deprecating voice as the rest of
  the app, always labeled "Sponsored — self-aware," with a direct "remove
  ads" link to `/premium`.
- **Premium status lives in `identity.db`**, not `content.db` — it's
  account metadata, not anonymous content.

## Design system

Colors and fonts live in `lib/theme.js` as a plain JS object (`C`):

- `ink` / `surface` / `surface2` / `line` — the near-black "leaked memo" shell
- `mustard` — primary accent (stamps, highlights, active tab)
- `flag` / `green` — red-flag / green-flag semantics
- `paper` / `corpblue` — redacted-document paper accent and "drained
  corporate blue" used to mock corporate-speak

Tailwind handles layout/spacing/flex; inline `style` handles anything
palette-driven. Keyframes `lo-pulse` (live indicators) and `lo-fade-up`
(resume-roast reveal) live in `globals.css`.

## What's mocked (honestly, and what's next)

- **Storage** — real PostgreSQL (`lib/db/pg-client.js`, `lib/identity/db.js`,
  `lib/content/db.js`) and real object storage (Backblaze B2, via
  `lib/storage.js`) — post/comment media and avatars in a public bucket,
  verification documents in a private bucket served only via short-lived
  signed URLs. No local files, no in-memory arrays. See DEPLOYMENT.md for
  provisioning both.
- **Deployment** — Dockerfile, `.dockerignore`, `fly.toml`, and
  DEPLOYMENT.md (Railway + Fly.io + custom domain) exist and the
  underlying standalone build was tested end to end, but `docker build`
  itself hasn't been run in this environment (no Docker daemon here) — see
  DEPLOYMENT.md for the exact commands to verify it yourself before
  trusting it in production.
- **Break-glass operator identity isn't verified** — see above; the
  two-person *shape* is enforced, real operator auth isn't.
- **Content tokens** are short-lived (5 min) but not tracked as
  single-use — a leaked token is valid for its window. A production
  version would track spent token IDs.
- **Vent Sessions have a real social/data layer** (creation, join, leave
  all persist, listener counts reflect genuine distinct accounts) **and
  now a real audio transport path** via LiveKit
  (`lib/livekit.js`, `app/api/rooms/[id]/token/route.js`,
  `components/VentAudioRoom.jsx`) — the token issuance, join flow, and
  client connection/mute/leave/speaking-indicator logic are all wired
  end to end and gracefully fall back to the original identity-only
  waiting room when `LIVEKIT_*` env vars aren't set. What's **not**
  verified: this hasn't been run against a live LiveKit server or real
  browsers in this environment (no network access here), and
  `livekit-client`/`livekit-server-sdk` aren't installed yet — run
  `npm install` after pulling this, set the three `LIVEKIT_*` vars (see
  `.env.local.example`), and test a real two-person call before trusting
  it in production. There's also no speaker moderation — anyone who
  joins can unmute; a "listener vs. speaker" stage model would be a
  follow-up.
- **Government ID / Business / Professional verification is real but
  manual** — a human runs `scripts/review-verification.js`, there's no
  automated KYC vendor integration (Persona, Stripe Identity, etc.).
  Deliberate: an instant fake "verified" badge would be worse than
  admitting this needs a human for now.
- **Multi-select polls aren't exposed** — the schema has a `poll_multi`
  column and the vote-dedup logic assumes single-choice; multi-select
  voting logic isn't built, so the composer only creates single-choice
  polls.
- **"Recommendation" notifications, a follow/connections graph, and any
  personalized feed ranking are explicitly not built** — interests are
  stored and shown on profile but don't drive any ranking or automatic
  recommendation, consistent with "no algorithmic anything" elsewhere in
  this app. A real "people you may know" or "companies matching your
  interests" feature would need a connections graph this pass
  deliberately didn't add, to keep the surface area sane.
- **Email notification preferences** — now real: per-category (Engagement,
  Social, Vent Rooms, Achievements, Verification, Account & Security)
  in-app/email/push toggles, backed by `notification_preferences`
  (`app/api/notification-preferences/route.js`, `lib/identity/service.js`).
  No digest batching — each notification still fires immediately when its
  category's email toggle is on.
- **Video/audio attachments ARE transcoded/compressed now** — `lib/transcode.js`
  shells out to a system `ffmpeg` binary (verified working end-to-end in
  this pass: a 176KB WAV test clip transcoded to a 25.6KB AAC file, and a
  test video to H.264/AAC MP4, both confirmed playable via `ffprobe`).
  Video is capped at 1280px on its longer side; audio is re-encoded to
  mono AAC. Falls back to storing the original file untouched if `ffmpeg`
  isn't on `PATH` or a specific file fails to transcode — **this means
  your production host needs `ffmpeg` installed**, which is NOT a given on
  serverless platforms (Vercel, Netlify Functions) unless you bundle a
  static binary (e.g. `@ffmpeg-installer/ffmpeg`) or use a host that
  provides it. A host with a persistent disk (the storage path this
  README's own storage-architecture guidance recommends) typically just
  needs `apt install ffmpeg` / the equivalent for your OS.
- **Google Sign-In** is implemented to Google's documented API contract
  but untested against Google's real servers (no network access to
  `accounts.google.com` from this environment) — same limitation as
  Stripe's live checkout flow.
- **Apple Sign In** is scaffolded but incomplete on purpose: it needs a
  paid Apple Developer account this environment doesn't have, and its
  ID-token signature verification is explicitly a placeholder (decodes
  without verifying — flagged directly in `lib/oauth.js`, not hidden).
- **Native app (`linkedout-native`) parity pass** — this round added the
  pieces that were genuinely missing: Bookmarks/Likes tabs and a
  bookmark button on posts, a reorganized Settings screen with new
  Download-Your-Data and Deactivate-Account sections, a dedicated
  Company detail screen, the renamed "Humble Brag Translator" screen,
  an X-style persistent header (logo, search, notifications, Upgrade,
  avatar, logout) across every tab, a real spring-animated
  `AnimatedPressable` used across the highest-traffic buttons, and a
  LiveKit-based real-audio path for Vent Rooms mirroring the web
  integration. Two things to know before trusting that last one: (1)
  `@livekit/react-native` + `@livekit/react-native-webrtc` ship native
  code, so real audio needs `npx expo install` for both **and** a custom
  dev client / EAS build — it will never work in plain Expo Go, and (2)
  none of this was run on a real device or simulator in this
  environment (no network, no device here) — treat it as implemented-
  but-unverified until you've smoke-tested it yourself. Older gaps this
  pass didn't touch — no submission-forms/verification/badges/search
  parity claims elsewhere in this README — should be re-verified rather
  than assumed still accurate, since some of that has clearly moved on
  since this paragraph was originally written.
- **Avatars aren't attached to individual posts** in the feed yet — only
  to the account's own profile page. A documented, deliberate scope cut,
  not an oversight (see `lib/avatars.js`).
- **Sybil resistance / brigading detection** (architecture doc Section 5)
  — the rate limiter caps volume per account, but nothing yet caps
  accounts per email domain or detects coordinated voting patterns.
