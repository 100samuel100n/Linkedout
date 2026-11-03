# This round of changes

## Set these environment variables (production)
- `TELNYX_API_KEY`, and `TELNYX_FROM_NUMBER` (or `TELNYX_MESSAGING_PROFILE_ID`) — SMS codes
- `KLIPY_API_KEY` (free, https://partner.klipy.com) — GIF search (Tenor is shut down). `GIPHY_API_KEY` optional fallback
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — now also used server-side for host controls
- Optional fraud tuning: `SMS_ALLOWED_COUNTRY_CODES`, `SMS_BLOCKED_COUNTRY_CODES`, `SMS_PREFIX_HOURLY_CAP`, `SMS_GLOBAL_HOURLY_CAP`, `OTP_TTL_MINUTES`
- Remove: all `TWILIO_*`, `TENOR_API_KEY`, `REQUIRE_VERIFICATION_FOR_PAID`

## After deploying
1. `npm install` (Twilio removed)
2. Schema migrates itself on first request (new tables/columns, duplicate reposts cleaned, every account gets a unique avatar)
3. Repair cold-start content: `node --env-file=.env.production.local scripts/reattach-post-images.js`
4. Native: rebuild the dev/production client (new assets, expo-audio, notification sound) — `eas build`

---

# Round 2

## New environment variables
- `MESSAGE_ENCRYPTION_KEY` — **required for messaging in production** (`openssl rand -base64 48`). Keep it out of the database; losing it makes stored messages unreadable.
- `APPLE_SIGNIN_ENABLED` — leave unset; Apple sign-in is shown as "Coming soon" and its routes return 503 until you set this to `true`.
- `ADMIN_*` is not used: company/dispute review is by script (see below).

## After deploying
1. `npm install`, redeploy (schema migrates itself: reactions become emoji, company registry, messaging tables, sound/DM prefs).
2. Fix zero follower counts + set a realistic Basic/Plus/Pro mix: `node --env-file=.env.production.local scripts/seed-social.js`
3. Native: new dependencies (`expo-clipboard`, `@react-native-community/slider`, `expo-haptics`) and 9 notification tone files → `eas build` a new binary.

## Operating the new systems
- Review company documents: `node scripts/review-company.js --list` then `--id <id> --decision verified|rejected --note "…"`
- Open reports: `node scripts/review-company.js --disputes`, resolve with `--dispute <id> --resolve "…" [--remove-content]`
- Message abuse reports are in the `dm_reports` table (evidence is encrypted; decrypt with the same `MESSAGE_ENCRYPTION_KEY`).
- Company terms text lives in `lib/company-terms.js` — **have a lawyer review it before launch.**
