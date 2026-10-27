# Security operations guide: what to set up, in order

Everything below is already built. These are the steps that need **your** accounts or credentials. Do them in this order; each is independent.

## 1. Five-minute essentials
1. `fly secrets set SECRETS_MASTER_KEY=$(openssl rand -base64 32)` : gives the vault its own key. **Back this key up**; losing it makes vault contents unreadable.
2. `fly secrets set PGSSL_VERIFY=true` (add `PG_CA_CERT="$(cat ca.pem)"` if your Postgres provider uses its own CA). Redeploy and check the app still connects.
3. Set `APP_ORIGIN=https://your-real-domain`.
4. In the admin: **Security Operations → Access**, add your office/home IP to the allow-list (Containment tab) so automation never touches it.
5. Leave containment on **Recommend only** for the first two weeks. Switch to **Automatic** once the alerts look sensible.

## 2. CAPTCHA (Cloudflare Turnstile): free
Cloudflare dashboard → Turnstile → Add site → copy the site key and secret →
`fly secrets set TURNSTILE_SITE_KEY=... TURNSTILE_SECRET=...`. It only appears when behaviour/IP risk is high.

## 3. IP reputation feed (optional): free tier
Create an AbuseIPDB account → API key → `fly secrets set ABUSEIPDB_KEY=...`.

## 4. SIEM
Pick any platform that accepts a webhook (Datadog logs intake, Splunk HEC, Elastic, Microsoft Sentinel, Better Stack). Put its URL/token in **Platform → Secrets vault** as `SIEM_WEBHOOK_URL` and `SIEM_WEBHOOK_TOKEN` (or as env vars), then press **Send test event**.

## 5. Staff SSO
In Google Workspace / Entra / Okta create an OIDC web application. Redirect URI: `https://your-domain/api/auth/sso/callback`. Then set `OIDC_ISSUER` (e.g. `https://accounts.google.com`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ALLOWED_DOMAINS`, `NEXT_PUBLIC_SSO_ENABLED=true`, and rebuild (the last variable is read at build time). Staff accounts must already exist with a staff role and the same email.

## 6. Security keys (FIDO2)
Run `npm install` (adds @simplewebauthn). Open **Security Operations → Platform → Add security key** on your **real domain over HTTPS** (WebAuthn does not work on plain http except localhost). Register two keys (primary and backup). Only then tick "Require the key".

## 7. Native app
`npx expo install expo-device expo-build-properties`, then make a **new EAS build** (new native modules need a rebuild; an OTA update is not enough). Posture reporting, root detection and R8 obfuscation take effect with that build.
For full app attestation: Android → enable the Play Integrity API in Google Play Console and send the token to a verification endpoint; iOS → App Attest (Apple Developer account). Both need your store credentials.

## 8. GitHub security workflow
Push `.github/workflows/security.yml`. For DAST add a repository **variable** `STAGING_URL` (a staging deployment, never production). Enable "Code scanning" in repo settings.

## 9. DDoS protection (do this before launch)
Put Cloudflare in front: add your domain to Cloudflare, switch the DNS record for the app to **proxied (orange cloud)**, set SSL mode to *Full (strict)*, turn on *Bot Fight Mode* and a rate-limit rule for `/api/auth/*`. In Fly, restrict the app to Cloudflare if you want to block direct hits (`fly ips` + allow-list at the proxy). The in-app **Under-attack mode** is a last resort that works with or without this.

## 10. Network segmentation
- Use Fly **private networking** (`.internal` address) or your provider's private endpoint for Postgres; remove any public database address and port.
- Give the database user only the privileges the app needs; use a separate read-only user for analytics.
- Keep object-storage (B2) keys scoped to one bucket.

## 11. Encryption at rest
Enable encryption on the Postgres volume/instance at your provider (Fly Postgres volumes and most managed Postgres are encrypted by default; confirm it). Application-level encryption already covers DMs, 2FA secrets and the vault.

## 12. EDR / XDR, MDM, confidential computing
- **EDR/XDR:** install Microsoft Defender for Business (cheap) or CrowdStrike/SentinelOne on every laptop that can reach admin. Forward their alerts to the same SIEM.
- **MDM:** enrol staff phones/laptops in Intune or Jamf; require screen lock + encryption. The app blocks staff on rooted/emulated devices on its own.
- **Confidential computing:** only if regulation demands it. Needs a cloud with secure-enclave VMs (Azure/AWS/GCP); Fly does not offer it.

## Operating it
- **Kill switch** (Security Operations, top right) reverts every automatic action immediately.
- If a mistake blocks everyone: set `SECURITY_PROXY=off` and redeploy; it disables the proxy layer without touching data.
- Run a **drill** monthly. Review the *Controls* tab quarterly.

## Email: sender identities by category
Different kinds of email now go out from different "From" identities, so password resets and receipts are never judged alongside newsletters:

| Category | From | Used for |
|---|---|---|
| security | LinkedOut Security `security@` | Email verification, password reset, staff sign-in codes, new-device alerts, account-deletion codes |
| account | LinkedOut `hello@` | Welcome |
| notifications | LinkedOut `notifications@` | Reactions, comments, Me-too, mentions, message/room activity (unsubscribe header) |
| support | LinkedOut Support `support@` | Ticket received/replied, appeal and verification decisions |
| billing | LinkedOut Billing `billing@` | Receipts, failed payments, refunds, advertiser invoices |
| business | LinkedOut for Business `business@` | Company domain/registration codes, business verification, ads decisions |
| legal | LinkedOut Legal `legal@` | DMCA acknowledgements, legal requests, policy changes |
| news | LinkedOut News `news@` | Announcements and newsletters (unsubscribe header) |
| service | LinkedOut Service Updates `updates@` | Outages and maintenance |
| alerts | LinkedOut Staff Alerts `alerts@` | Incident/security alerts to staff |

Setup: verify your **domain** once in Resend (Domains → Add → add the DNS records), then set `EMAIL_DOMAIN=your-domain.com`. You do not need mailboxes for the sending addresses.
Set a real inbox people can reply to, e.g. `EMAIL_REPLY_SUPPORT=help@your-domain.com`, `EMAIL_REPLY_BILLING=...`, `EMAIL_REPLY_LEGAL=...`.
Any single category can be overridden: `EMAIL_FROM_BILLING="LinkedOut Billing <billing@pay.your-domain.com>"` (a separate subdomain per stream is the best practice for large volumes).
Until `EMAIL_DOMAIN` is set, every category still gets its own display name but sends from `RESEND_FROM_EMAIL`, exactly as before.

## Staff sign-in: how the pieces fit
- **Password + a second step** is always required for the admin console. The second step can be: authenticator app, emailed code, security key/passkey, or a one-time recovery code. Enrol two methods so one lost phone never locks you out.
- **Company SSO (OIDC)**: once configured, the login page shows "Staff single sign-on" and the admin gate shows "Or sign in with company SSO". It replaces typing the password; the admin second step still applies unless your identity provider reports MFA and you set `OIDC_REQUIRE_MFA=true`.
- **ABAC policies** (Security Operations → Access) are your conditional access: for example, only allow severe enforcement 08:00–18:00 UTC from your country.
- **Roles** decide what each person can do after signing in; **JIT grants** give temporary elevation that expires on its own.
- **Native app**: staff can use the authenticator, emailed or recovery code. Security keys are used from the web console.
