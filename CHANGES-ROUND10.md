# Round 10

Not built or run in the sandbox (no node_modules / network). Run `npm install && npm run build` before deploying.

## Fixes
- Posting only once: client-side synchronous lock (Pulse composer, replies, stories, native too) + server guard (20 s on posts, 60 s on stories).
- Drafts: reopen in the editor (`/stories/new?draft=<id>`, native `StoryComposer {draftId}`), update in place, publish from there. New `PUT /api/stories/[id]`.
- Web: "My stories & drafts" in side nav, profile menu and Profile page.
- AI: code is fine; it needs ANTHROPIC_API_KEY (or the provider you set). New admin section "AI Health Check" runs one live call and says which of code / key / model / quota / network is the cause.
- Keyboard: web rewritten by input type (docked/sticky, forms upper-third + scroll padding, expanding textarea cap + internal scroll). Native: KScrollView upper-third placement + dynamic padding; chat input max-height from visible area.
- Native messaging: new inbox (gradient avatars, unread ring/badge, pill tabs, search clear) and chat (gradient bubbles, floating composer, avatar header).

## Roles
- Roles and permissions are in the database (`rbac_roles`, `rbac_permissions`), ~700 permissions, edited in **Roles & Permissions** (web) and the native admin screen. A role can grant a plan; `effectiveTier` is returned to clients and used by web + native.
- Views & Metrics admin section.

## Security & incident response (web)
- **Security Operations** admin section: alerts (low/medium/high/critical), incidents with timelines, AI/playbook recommendations, permanent-fix tasks, containment actions, rules, allow-list, ABAC policies, JIT access, honeytokens, kill switch, drills, controls coverage.
- Perimeter in `proxy.js`: WAF, attack-tool UAs, IP/country blocklist, tarpit, throttle, honeytoken detection. Fails open.
- Detections: auth failures, impossible travel, new device, scraping (rate-limit breaches), mass downloads, MFA fatigue, privilege escalation / policy deviation, honeytoken/honeypot, WAF match.
- Containment safety: default mode is **recommend** (human approves); auto mode only touches one IP/ordinary account, never staff/allow-listed IPs, always expires, reversible; circuit breaker; kill switch; self-lockout guard; false-positive undoes measures.
- Baseline security headers; `npm run sast`; optional `PGSSL_VERIFY=true` (+ `PG_CA_CERT`) to verify the Postgres certificate (SAST found it was disabled).

## Env (optional)
SECURITY_INTERNAL_KEY (else derived), SECURITY_PROXY=off (emergency off switch for the proxy layer), PGSSL_VERIFY.
