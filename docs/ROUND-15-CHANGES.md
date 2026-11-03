# Round 15: timeline, kill switch, push diagnostics, share cards, replies, audit

Everything below is in the two projects (`linkedout-app` web/server, `linkedout-native` app). Server logic is covered by `npm run test:dist`
(14 tests, including a new end-to-end kill test). The native and admin UI code was syntax-checked but **not built or run on a device**: see "Verify before you ship".

## 1. What changed

| Request | What now happens | Where |
|---|---|---|
| Admin sets when things were posted, everywhere | Admin → Content Moderation / Pinned & Featured / Stories → **Set posted time**. One value (`created_at`) drives Pulse order, the Awards board, story lists and "x ago". A post and the stories grown from it move together. Past time = shown as posted then (a draft/scheduled story is published at that time). Future time = hidden until then (existing schedulers publish it). Real time kept in `real_created_at`. | `lib/admin/timeline.js` |
| Stories that haven't been posted | Stories section lists drafts and scheduled stories; **Set posted time / publish** publishes them with the time you choose (or "now"). | same |
| Install data | Admin → Installs & Devices and Web App Installs now show **name, email, handle, exact IP, network location, ISP, device facts**, and exact GPS **only if the person agreed on their device**. IP and coordinates are stored encrypted. Viewing is written to the audit log. | `lib/distribution/details.js`, `admin.js` |
| Share as a styled card | Shared links now unfurl as a 1200x630 branded card (Pulse, Awards badge, Story). The real bug: web shared `/#post-id` (the home page) and the native app shared **text only**. Both now share `/post/<id>`. | `lib/share-card.js`, `app/post/[id]/*`, `PostCard` |
| Story "Warn others / Find others / Support / Advice" | Each now has a workflow: readers leave replies of that kind (Support, Advice, Warn, "Me too, let's connect", Reply), threaded, aliased, PII-redacted, rate-limited. The author is notified; "no advice" is respected. | `lib/stories/responses.js`, `StoryResponses` (web + native) |
| Anonymous names | Replaced "Anonymous Otter" with creative names ("Midnight Spreadsheet Whisperer"), written by the AI when available and falling back to a local generator in under 2 s. | `lib/identity/alias.js` |
| Admin can rename how authors appear | Stories → **Change author name** (this story, or every story/post/reply by that author), **Suggest names (AI)**. Locked so the author's later edits don't overwrite it. | `lib/admin/aliases.js` |
| Scheduled push | Web composer already had it; the **native admin composer now has it too**. | `AdminBroadcastScreen.js` |
| Push arriving only as in-app | See section 3. Sends are always both (in-app row + push); failures now say *why*. | `lib/push.js`, `broadcast.js` |
| Kill switch | See section 2. | `lib/distribution/kill.js`, native `lib/killswitch.js` |
| Remove web splash | Removed (`AnimatedSplash` deleted, boot cover never shows). | `NativeFeel.jsx`, `layout.js` |
| Action history + undo | New **Action History & Undo** section. Undo restores exact snapshots for: timeline changes, author renames, install kills, web-app kills, policy settings, and story/post remove/restore/edit/feature/unpin/denominate. | `lib/admin/history.js` |

## 2. Kill switch (why "revoke" didn't stop anything, and the fix)

Root causes found in the code:
1. "Revoke" only meant *re-register*, and the app's `recover()` did exactly that, so a genuine APK came straight back.
2. In the default `monitor` mode nothing was ever blocked.
3. Re-registration never checked for a killed device or a withdrawn version.
4. An already-signed-in app kept its cached data and worked offline.

Now, **Kill install** (and withdrawing/deleting a release, and the "tamper" bulk action) does all of this:
- install status `killed`; refused in **every** mode (even `off`) by the session gate **and the edge proxy** (within ~5 s)
- the **device is blocked** (hashed Android ID), so reinstall/re-register on that phone is refused (`INSTALL_KILLED`); a withdrawn **version** cannot register, but the phone can install the next official build
- account sessions dropped (optionally account suspended); silent kill push sent
- the app writes a tombstone to secure storage **synchronously**, unmounts the **entire** app (`<KillGate>` in `App.js`: no screens, providers or timers survive), wipes token, install key, app lock, AsyncStorage, files, caches and notifications, and shows only the lock screen. On the next launch the tombstone is read before the first render, so it is locked in the first frame, offline or not.
- **Offline bypass**: a signed, expiring **licence lease** (`/api/distribution/lease`). With *Require a valid licence lease* on, the app won't open without a valid lease; a killed install gets a signed kill order instead. Clock rollback is detected.
- Web app (PWA): **Kill this web app** clears storage/caches/service workers, signs out, and re-locks instantly on every open; open web apps check in once a minute.
- Undo: Action History → Undo (or **Restore**). A restored phone must open online, re-register and sign in again.

**Honest limits.** A phone that has *never* contacted the server again and has *no* lease requirement can't learn it was killed: turn on **Require licence lease** (lease length is a setting; 24 h default) once most users have updated. Builds from before the install-registration feature can only be cut off by setting mode to `enforce` (then they can't sign in and every call is refused). Rooted/hooked devices can defeat any client-side lock; the server-side refusals are the part that can't be bypassed.

## 3. Push: "Nothing was delivered"

I can't see your Expo/Firebase account, so I can't tell you which credential is wrong. What I found and fixed:
- Failures were swallowed: any non-200 from Expo became an empty list and the admin only saw a generic message. Now the **real reason** is shown (e.g. `InvalidCredentials`, `MismatchSenderId`, `DeviceNotRegistered`, HTTP 401, no registered devices) with what to do.
- "ok" from Expo only means *accepted*. The server now checks **delivery receipts** ~15 min later, removes dead tokens and appends any Google/Apple failure to the broadcast.
- **Bug**: sound files are `tone_signal.wav` (underscore) but pushes and Android channels used `tone-signal.wav` (hyphen). Fixed; channels renamed `n2_*` so phones that created the broken ones get fresh ones.
- Most likely cause of in-app-only delivery: **no FCM V1 key uploaded to EAS** (or a key from a different Firebase project than `linkedout-7a1f5`). Do: `eas credentials` → Android → Google Service Account Key for FCM V1, then send a test from Admin → Push. Also check `EXPO_ACCESS_TOKEN`. Expo Go and emulators never get tokens.
- Admin → Push → status now lists recent delivery problems.

## 4. Security audit against your checklist

Legend: **Present** (already in the code), **Added** (this round), **Your action** (needs a secret/build step I can't do), **Gap**.

| Layer / item | Status | Detail |
|---|---|---|
| **1. Faking** | | |
| Cryptographic code signing | Present + Your action | Ed25519-signed manifest/updates (`sign.js`); app compares the **signing-cert SHA-256** via hardware key attestation (`DIST_APK_CERTS`); release build refuses debug signing (`with-direct-distribution.js`). Set `LO_KEYSTORE_*` or EAS credentials. |
| Anti-tampering | Present | debugger / tracer / Frida / Xposed / root / emulator signals, reported to server; `tamper_action` report/block. Default **report** on purpose (false positives). |
| Obfuscation | Present | R8 minify + resource shrink on release; Hermes bytecode. |
| Official hash verification | Present | SHA-256 + key fingerprint on `/install`; app verifies update file hash before install. |
| **2. Stealing** | | |
| Certificate pinning | **Gap (off by default)** | Implemented in the plugin but only active when `LO_TLS_PINS` has **2+ pins** at build time; none set in `eas.json`. Add the production key pin + a backup pin. A single pin is refused on purpose (rotation would lock everyone out). |
| Least-privilege permissions | Present | Only mic, Bluetooth connect, audio settings, biometric. No location permission: precise location (below) is optional and appears only if you install `expo-location`. |
| Encrypted local storage | Present + Added | Session token, install id and app lock in Android Keystore-backed SecureStore; backups disabled; user-installed CAs not trusted; HTTPS only. Server side: **IP and GPS now AES-256-GCM encrypted** (`SECRETS_MASTER_KEY`). The kill wipe clears local data. |
| **3. Installs** | | |
| Domain isolation & verified channels | Present | official-domain list, clone-site beacon + red warning bar, channel allow-list, look-alike tracking. |
| In-app update | Present | signed manifest, hash check, Android installer hand-off. |
| R8/ProGuard | Present + Added | see section 5. |
| Integrity checking | Present | hardware key attestation chain verified server-side, per-request signatures bound to the token, replay/clock-skew checks. |
| Strip debug & metadata | Present | release builds only; debuggable flag reported as a signal. Source maps are not shipped. |
| **Layers** | | |
| Strategy | Present + Added | mode off/monitor/enforce, break-glass, audit log, **now undo**. |
| Code | Present | as above. |
| Storage | Present + Added | as above. |
| Network | Present/Gap | HTTPS-only + no user CAs (present); pinning needs your pins. Edge proxy rules, rate limits, bot rules (present). |
| Install | Present + Added | kill switch, device block, lease. |

**False-positive protection (Integrity checks must not lock out real users):** defaults are `monitor` mode, `min_trust: software`, `tamper_action: report`. Kills never fire automatically from signals; only an admin action (or the explicit "tamper" bulk action) kills. Before `enforce`: (1) put **every** certificate that signs your APK in `DIST_APK_CERTS`, including the **Play App Signing** certificate if you also publish on Google Play (Play re-signs, so its cert differs), (2) watch Integrity Center for a week, (3) keep the lease length generous (>= 24 h) and turn `require_lease` on last.

## 5. R8/ProGuard and Crashlytics: what I did and didn't do

I did **not** write library keep rules from memory. What the official sources say, and what's in the app:
- Android's own guidance: libraries ship **consumer rules** that R8 merges automatically; add app rules only for JNI/reflection, and use the `missing_rules.txt` R8 generates when it reports missing classes. LiveKit's SDK ships its own consumer rules (WebRTC JNI). The two LiveKit lines already in `app.json` came from R8's own output for your build and are kept.
- Firebase's documented requirement for readable Crashlytics traces is `-keepattributes SourceFile,LineNumberTable` and (optional) `-keep public class * extends java.lang.Exception`. **Both added to `app.json` → `extraProguardRules`.**
- I could not find an official keep-rule page for `react-native-google-mobile-ads` or Google Sign-In, so I added **none**. Their SDKs ship consumer rules.
- **Procedure for every release build:** if R8 fails with "Missing classes detected", open `android/app/build/outputs/mapping/release/missing_rules.txt` and add exactly those rules; test sign-in with Google, ads, voice rooms (LiveKit), push, update download and app lock on the release APK before publishing.
- **Crashlytics** (not installed yet; adding it needs network and a native build): run `scripts/setup-crashlytics.sh` in `linkedout-native`. It runs `npx expo install @react-native-firebase/app @react-native-firebase/crashlytics` and adds both plugins to `app.json`. Per Firebase's docs the Crashlytics Gradle plugin then **uploads `mapping.txt` automatically** on every R8 build; no manual upload. Note: React Native Firebase's Expo docs require `useFrameworks: "static"` for **iOS**, which can conflict with other iOS pods, so the script only touches Android unless you pass `--ios`.

## 6. Verify before you ship
1. Build a `direct` APK; install on a real phone; sign in.
2. Admin → Installs → **Kill install** → the app must lock within seconds, stay locked after force-close and reboot, and the same phone must fail to re-register. Then **Undo** in Action History and use **Check again** on the lock screen.
3. Admin → Push → send a test; read the exact error if it fails.
4. Share a post from web and from the app into WhatsApp/LinkedIn: card should appear.
5. Run `npm run test:dist` in the web project.
6. Privacy: update the policy to disclose IP/location collection (Kenya DPA 2019 / GDPR), and decide the retention (`purgeOldDetails`, default 180 days; schedule it).
