# Round 2 changes (web + native)
- Admin: Search Admin section fixed (global search moved to /api/admin/gsearch; it was hijacking the section), robust global search, permanent company delete (type DELETE), comprehensive Vent Rooms (list + per-room detail with participants, date/time, duration, peak, roles), ads: simple + full-page ads, appearance (layout/colours/radius/label/image), pin position + priority, Inject now, Duplicate; Feed controls now manage direct ads, Google AdSense (web) and AdMob (app).
- Ads: AdSense unit (web), AdMob banner (native, lazy-loaded), full page ad route /ad/[id] and native AdPage screen.
- Cold start: scripts/lib/engagement.js + scripts/seed-engagement.js (npm run seed:engagement) seed likes, emoji reactions, comments, comment likes/reactions, saves, reposts, poll + cringe votes, follows, plans. Old seed used removed reaction names ("cry", "laugh"...), which is why reactions never landed.
- Vent tile on web home now links to /vent. Tagline replaced with "Linkedout" everywhere.
- Offline error: clients only report offline when the device really is offline, retry safe requests once, shorter messages.
- Optimistic poll voting (web + native). Reactions show top 3 + a "+N" chip opening a full breakdown (GET /api/posts|comments/[id]/react).
- Native logout/login stale-account bug: server now prefers Bearer token over cookie; native omits cookies and calls /api/auth/logout.
- Plans renamed OUT / OUT+ / OUT PRO with the new comparison rows; verified ticks (blue OUT+, gold OUT PRO); profile views + analytics (/profile/insights, /api/profile/views) with discreet, plan-gated visibility; discovery boost in people search.
- Splash: code-drawn small 2D scene, no text, not skippable, arc flight, door slam.
- Errors: ErrorNote component (neutral, one short sentence) replaces red sentences.
- Emails: redesigned shared layout and templates.
## Native setup
npm install (adds react-native-svg and react-native-google-mobile-ads); AdMob needs a dev/production build, not Expo Go. Set ADMOB_ANDROID_APP_ID / ADMOB_IOS_APP_ID at build time.

# Round 3: messaging perks + design system
- Messaging perks enforced server-side from one table (lib/tiers.js MESSAGING): OUT can only start chats inside their network (follow either way), 5 requests/day; OUT+ messages outside network, 20/day; OUT PRO 60/day, priority requests (flagged and sorted first, notification says "Priority request"), 1,000 messages/day and longer messages (8,000 / 600-char requests), message analytics (/messages/analytics, /api/messages/analytics) and AI-assisted outreach (/api/messages/ai-outreach, 3 drafts, 20/day, needs ANTHROPIC_API_KEY).
- Design system: tokens (4 surfaces, 3 text levels, indigo accent, radii, shadows) in globals.css / lib/theme.js / native lib/theme.js; shared kit components/ui (Loading skeletons, EmptyState, Button, Field, Avatar, PageHeader; native equivalents); every "loading…" replaced; min text size 12px; bottom tab bar on mobile web; redesigned sidebar, Messages, Settings, admin console; native tab/stack bars.
