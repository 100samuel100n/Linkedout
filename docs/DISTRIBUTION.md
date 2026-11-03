# Direct distribution, app integrity and the admin controls

This document is the operator's guide. Code lives in `lib/distribution/`, the public API under `app/api/distribution/`, the public page at `/install`, and the Android side in the `linkedout-native` project (`modules/lo-integrity`, `lib/integrity.js`, `components/IntegrityGate.js`, `plugins/with-direct-distribution.js`).

## 1. What a fake can and cannot do

| Attack | What stops it |
|---|---|
| Repackaged APK (modified, re-signed with another key) | Cannot register: hardware key attestation names the signing certificate; ours is not in the chain. No install key = no signed requests = no session (in `enforce` mode). |
| Fake app talking to **its own** server to collect passwords | Not stoppable by server code. Reduced by: one signed manifest + one install page, the app's pinned update key, look-alike scanning with takedown kit, user reports, 2FA on every account. Passkeys would be the next real step. |
| Stolen session token replayed elsewhere | Native tokens only work together with a signature from the install key (hardware-backed, non-exportable). The signature covers a hash of the token. |
| One copy abused (bots, scraping) | Per-install request counter, `install_abuse` alert, one-click **Revoke key** (that copy stops, must re-register). |
| Old / vulnerable build | Minimum version (edge-enforced, HTTP 426), per-version feature switches, **Withdraw** a release (revokes its installs). |
| Fake update server | Update answers are Ed25519-signed; the public key is compiled into the app; the APK's SHA-256 comes from the signed answer; Android itself refuses an update signed with a different certificate. |
| Website cloned | `frame-ancestors 'self'` (no iframe wrapping), clone beacon (our JS running on another host reports itself and shows a warning), look-alike domain scan. |

**Honest limits.** Nothing stops someone reading or copying the app's *design* or its API shape: a UI that is shown to users can always be re-created. What the system does is make a copy *useless against your server* and *discoverable*. Client-side checks (debugger/Frida/Xposed/root/emulator signals) are speed bumps that a determined attacker can hide; they are reported to the server and optionally block, but the real controls are attestation and the server-side checks. A device with a compromised secure element can produce valid attestations. iPhone/PWA has no attestation: the PWA is the website, protected by the web's normal defences.

## 2. Launcher/installer vs built-in updater (your question)
Keep **one APK with the built-in updater**. A separate launcher that downloads the real app adds a second thing to trust, is the same pattern malware droppers use (Play Protect and antivirus flag it), and does not prevent fakes: the fake would just ship its own launcher. Encrypting the payload doesn't help either, because the decryption key has to live on the phone. What actually protects you is (a) Android refusing updates signed with a different key, (b) the signed update answer + hash, and (c) server-side attestation. All three are in place.

## 3. One-time setup (in this order)
1. **Your own release keystore.** The generated Android project signs `release` with the public `debug.keystore`. Create a keystore once (`keytool -genkeypair -v -keystore linkedout-release.jks -alias linkedout -keyalg RSA -keysize 4096 -validity 10000`), back it up in two places. *If you lose it, nobody can update the app.* Local builds: set `LO_KEYSTORE_PATH`, `LO_KEYSTORE_PASSWORD`, `LO_KEY_ALIAS`, `LO_KEY_PASSWORD` (the build fails instead of using the debug key). EAS: `eas credentials` (upload this keystore). Use the **same** key for every channel so updates work everywhere. (If you previously shipped via Play App Signing you cannot reuse Google's key: direct builds are a new signing identity.)
2. `node scripts/dist-keygen.mjs` → set `DIST_SIGNING_KEY` on the server; put the public value in the `direct` profile as `EXPO_PUBLIC_DIST_PUBLIC_KEY`; publish the fingerprint in 3+ independent places and list them in `DIST_FINGERPRINT_SOURCES`. Keep an offline backup of the private key.
3. `DIST_APK_CERTS` = SHA-256 of your release certificate (`apksigner verify --print-certs app.apk`). 
4. `DIST_ATTEST_ROOTS` = Google's attestation root certificate(s) PEM (Android developer docs, "Verify hardware-backed key pairs"). Without it every device is capped at `software` trust.
5. `DIST_RELEASE_TOKEN` (24+ random chars) for `scripts/dist-release.mjs`.
6. Deploy. Build the app: `eas build -p android --profile direct` (or `direct-samsung`, `direct-huawei`).
7. Upload the APK to storage/CDN, then `node scripts/dist-release.mjs --apk ... --url ... --name 1.0.0 --code N --site https://linkedoutnetwork.com`. In **Admin → Releases & Updates** review and **Publish**. `/install`, `/dl/apk` and the manifest go live.
8. Add channels in **Admin → Channels & Mirrors** (templates in `distribution/`).
9. **Rollout of verification:** leave **mode = monitor** for about a week. Watch **Integrity Center**: every failure shows its reason. When real users all register at the trust level you want, set **mode = enforce**. (Enforce is refused until at least one official certificate is set, so you cannot lock everyone out by accident.)

## 4. What you can see and do (Admin → Distribution)
**Detect** – Integrity Center, plus Security Operations alerts (existing SOC, incidents, containment):
- registrations failing attestation (wrong certificate / unknown package) → `attest_failure`
- spikes of failures → `integrity_spike` (threshold in policy)
- unknown app versions → `unknown_version`
- abnormal usage per install → `install_abuse`
- user reports (/install → "Found a fake?") → `fake_report` (+ escalation at 3 reports/24 h)
- look-alike domains and APK sites → `lookalike_domain`; our site code running elsewhere → `clone_site`

**Respond**
- **Revoke key** (Installs & Devices): that copy is cut off at the edge within ~15 s and must re-register; a fake can't. *Revoke + block account* also suspends the linked account (existing enforcement system, 30 days).
- **Minimum app version** (policy) and **Mandatory** flag per release.
- **Feature Switches**: switch a feature off for a range of app versions (the app reads them; also hides Jobs).
- **Withdraw** a release: marks it revoked in the manifest and revokes the installs that run it.
- **Report the fake**: Look-alikes & Fakes → *Prepare reports* looks up registrar and host abuse contacts (RDAP) and writes a factual report plus Google Safe Browsing / SmartScreen / Cloudflare links. A person sends it; nothing is sent automatically.
- **AI help (optional, off by default)**: triage notes, look-alike assessment, report polishing. Advisory only; sees counts/reasons/domains, never emails, tokens or raw IPs; needs `distribution.ai` permission and the switch in policy.

Permissions: `distribution.read / manage / release / respond / ai` (granted to the admin role automatically; assign individually in Roles).

## 5. Update options
- **Built-in updater** (done): checks every 4 h and on start, signed answer, hash check, mirrors tried in order, Android installer.
- **Own F-Droid repo, Obtainium, Zapstore, Samsung, Huawei, Aptoide, APKPure**: channel records + templates in `distribution/`. Publishing to each is a manual submission to that store.
- **Over-the-air JS updates (NOT built).** This needs `expo-updates` plus either EAS Update with code signing or a self-hosted Expo-Updates-protocol server. I did not add it: it changes the native build, and an untested OTA path is a risk to every install. The in-app APK updater covers all changes today. Tell me if you want the self-hosted OTA server added as a separate step.

## 6. Verifying the real app (for anyone)
`/.well-known/linkedout-distribution.json` = `{ payload, signature, keyId, alg:"Ed25519" }`. Signature is over the **canonical JSON** of `payload`: object keys sorted recursively, no whitespace, UTF-8 (reference: `canonicalJson` in `lib/distribution/canon.js`). Verify with `node scripts/dist-verify.mjs https://linkedoutnetwork.com --key "<fingerprint>" --apk file.apk`. **The fingerprint must come from somewhere other than the site being checked**, otherwise a copycat's own key verifies fine.

## 7. Key rotation / compromise
Manifest key: generate a new pair, ship an app update that trusts the new key, then switch `DIST_SIGNING_KEY`. If the key leaks before that, ship a new app build signed with the new public key via the old channel *and* mark the old build mandatory. APK signing key: cannot be rotated for existing installs without Android's key-rotation lineage (`apksigner rotate`); protect it.

## 8. JOBS_ENABLED
Admin → Feed Controls → **Jobs (web and app)**, or `JOBS_ENABLED=false` in the environment for a deployment-level hard off. Off: `/jobs` shows a notice, the nav and search tab disappear, the app hides the tab, every `/api/jobs/*` returns 503 `JOBS_PAUSED`, the jobs cron stops sending reminders. Nothing is deleted.

## 9. Not verified in the build sandbox — test before you rely on them
Server crypto (attestation parsing, manifest signing, request signatures) is unit-tested (`npm run test:dist`, 12 tests, against synthetic chains). I could **not** compile or run: the Kotlin module, the Expo/Gradle build, the Next.js build, JSX files, or anything on a real phone/Play-less device. First-run checklist: (1) `npx expo prebuild --clean` and a `direct` build; (2) register on a real phone and confirm trust = `hardware` in Installs & Devices (real attestation extensions can differ in detail from my test chains); (3) revoke it and watch it recover; (4) update from 1.0→1.1 through the in-app updater; (5) iPhone: Add to Home Screen, check status bar/safe areas and that installs show up as PWA installs.
