# Round 11

Not built or run in the sandbox. Run `npm install` (new: @simplewebauthn/server + browser) then `npm run build`.
Native: `npx expo install expo-device expo-build-properties`, then a NEW EAS build (native modules).

## Keyboard (native) — root cause fixed
KeyboardSafeView added the existing padding back into its own measurement, so the padding grew on every re-measure
(that was the big blank gap and the vanishing form fields). Fixed. KScrollView now measures its own visible box and puts the
focused field in the upper third of what is actually visible. Chat composer hugs the keyboard (bottom inset only when the keyboard is closed).
Chat ⋮ menu is anchored under the header button.

## Voice notes / files "upgrade" message
Plan info is now loaded with retry and fetched on demand (it previously failed silently and then assumed "no plan").
The server also treats a paying account with an unset tier as PRO. If you still see it, the message now says which plan the server sees.

## Security: everything partial/external is now built or prepared
See docs/SECURITY-OPERATIONS.md for the exact steps that need your credentials, and Security Operations → Controls for status.
New: Vault (PAM + secrets), WebAuthn security keys, OIDC staff SSO, Turnstile + behavioural scoring, IP reputation, SIEM forwarding,
DLP fingerprints + trace, device posture / root detection (native), under-attack mode + flood limit, canary deploys + /api/health,
GitHub Actions (CodeQL, secrets scan, SAST, ZAP), R8 obfuscation for native release builds.
