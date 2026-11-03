# Push notifications & broadcasts — setup checklist

Everything is already wired in code (device registration, per-user tone/sound/vibrate, quiet categories,
admin broadcasts to segments / individuals / everyone, scheduling, history, test sends). What's left is
**credentials**. Do these once; each step says exactly which value goes where.

## 1 · Native app (linkedout-native)

| Value | Where it goes | How to get it |
|---|---|---|
| **EAS project id** | `EXPO_PUBLIC_EAS_PROJECT_ID` in `.env` **and** in `eas.json` (replace `REPLACE_WITH_YOUR_EAS_PROJECT_ID`, 3 profiles) | `npm i -g eas-cli` → `eas login` → `eas init` (or expo.dev → project → Overview). Without it the app can't get a push token. |
| **Firebase `google-services.json`** (Android) | Save it in the `linkedout-native` folder (default path), or set `GOOGLE_SERVICES_JSON=/path/to/file`. On EAS you can also create it as a *file* secret named `GOOGLE_SERVICES_JSON`. | console.firebase.google.com → create project → add **Android app** with package `com.linkedoutnetwork.linkedout` → download `google-services.json`. |
| **FCM v1 service-account key** (Android sending) | Uploaded to EAS, not stored in the repo | Firebase → Project settings → Service accounts → *Generate new private key* → `eas credentials` → Android → *Google Service Account* → *Manage your Google Service Account Key for Push Notifications (FCM V1)* → upload. |
| **APNs key** (iOS) | Managed by EAS | `eas credentials` → iOS → *Push Notifications: Manage your Apple Push Notifications Key* → let EAS create it (needs your Apple Developer account). |

`app.config.js` reads these automatically; you never edit `app.json` for them.

**Build a real app — push does not work in Expo Go (SDK 53+):**
`eas build --profile development --platform android` (or `ios`), install it, log in, allow notifications.

## 2 · Backend (linkedout-app) — `.env.local`

| Variable | Needed for |
|---|---|
| `EXPO_ACCESS_TOKEN` | expo.dev → Account settings → Access tokens. Recommended for production ("enhanced security"). |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email broadcasts (you already have Resend). From address must be on a domain verified in Resend (SPF/DKIM). |
| `RESEND_REPLY_TO`, `EMAIL_FOOTER_ADDRESS` | Optional; footer address is recommended for marketing email. |
| `CRON_SECRET` | Only on serverless hosts. On Fly/Docker/VPS the built-in scheduler (`instrumentation.js`) sends scheduled broadcasts every minute. |
| `NEXT_PUBLIC_APP_URL` | Your real https URL — it's used for the logo, links and unsubscribe links inside emails. |

## 3 · Verify, in this order
1. Open the native dev build, log in, accept the notification prompt.
2. Admin dashboard → **Messaging → Push Notifications**: the status panel should show your device count.
3. Click **Send test to my devices**. You should get a notification within seconds.
4. **Messaging → Email Broadcasts** → **Send test email** (goes to your own address, marked [TEST]).
5. Then send a real one to a small segment (e.g. *Staff only*) before going wide.

## How it behaves
- **Announcements & offers** is a new notification category people can switch off per channel in Settings; marketing broadcasts respect it. **Service notices** (outages / security / legal) ignore it — use sparingly.
- Every marketing email has a one-click unsubscribe link and `List-Unsubscribe` headers (this only turns off announcement emails, never account/security email).
- A broadcast is claimed atomically in the database, so it can't send twice even with several server instances.
- If the server restarts mid-send the broadcast is marked *failed — interrupted* and is **not** retried automatically (to avoid duplicates).
- Dead devices are removed automatically when Expo reports them unregistered.
