// Coverage register. status:
//  "live"     = implemented and enforced now, no setup needed
//  "setup"    = fully built in the code; switches on when you add the credential/step listed in `text`
//  "external" = needs hardware/infrastructure that code alone can't provide; configuration and a guide are included
//  "partial"  = implemented in part (what's missing is stated)
export const CONTROLS = [
  ["1 · Identity & governance", [
    ["Role-Based Access Control (RBAC)", "live", "Database-backed roles with ~700 permissions, edited in Roles & Permissions; enforced on every admin API call."],
    ["Attribute-Based Access Control (ABAC)", "live", "Policies (Access tab) limit staff permissions by UTC hours, country and network; device posture is also checked."],
    ["Privileged Access Management (PAM)", "live", "Standing access is minimal; JIT grants expire; every privileged action is audited; secrets in the Vault can only be revealed with a recorded reason."],
    ["Just-In-Time access", "live", "Time-boxed role grants with a mandatory reason that expire and revert automatically."],
    ["Multi-factor authentication", "live", "Staff TOTP is enforced on every admin API call; repeated wrong codes raise an MFA-fatigue alert."],
    ["Phishing-resistant MFA (FIDO2 / hardware keys)", "live", "Security keys and passkeys (WebAuthn) register under Platform and satisfy the admin second factor; an option disables the code fallback for key holders. Needs HTTPS on your real domain."],
    ["SSO with conditional access", "setup", "OpenID Connect sign-in for staff (Google Workspace, Entra, Okta…). Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_ALLOWED_DOMAINS and NEXT_PUBLIC_SSO_ENABLED=true. Conditional access = ABAC policies + optional OIDC_REQUIRE_MFA."],
    ["MDM (mobile device management)", "partial", "The app reports posture (root/jailbreak, emulator, debug build, app version, screen lock) and staff on non-compliant devices are blocked. Remote wipe and fleet inventory need an MDM product (Intune, Jamf, Workspace ONE); the guide lists the steps.", "gap"],
  ]],
  ["2 · Application, code & data protection", [
    ["SAST", "live", "`npm run sast` plus a CodeQL + secret-scan workflow in .github/workflows/security.yml."],
    ["DAST", "setup", "The workflow runs an OWASP ZAP baseline scan against your staging URL. Add the STAGING_URL repository variable."],
    ["Secrets management (cryptographic vault)", "live", "AES-256-GCM vault with audited reveal and rotation. Set SECRETS_MASTER_KEY to give it its own key."],
    ["Code obfuscation", "setup", "Native release builds enable R8 minify/obfuscation and resource shrinking (expo-build-properties) on top of Hermes bytecode. Applies on your next EAS build."],
    ["Anti-debugging & integrity checks", "partial", "The app flags debuggable builds and emulators in posture reports. Cryptographic app attestation (Play Integrity / App Attest) needs Google/Apple credentials: guide included.", "gap"],
    ["Root / jailbreak detection", "live", "Native app uses expo-device's root/jailbreak check and reports it; staff on rooted devices are blocked."],
    ["Encryption in transit", "live", "HTTPS plus HSTS and baseline security headers; set PGSSL_VERIFY=true to verify the database certificate."],
    ["Encryption at rest", "partial", "Direct messages, staff 2FA secrets and the Vault are encrypted at the application layer. Enable volume/database encryption at your host (guide included).", "gap"],
    ["Tokenization & masking", "live", "IPs, emails and honeytokens are masked in Security Operations unless the role has PII access."],
  ]],
  ["3 · Perimeter, anti-scraping & bots", [
    ["Web Application Firewall", "live", "proxy.js inspects every request for SQLi, XSS, traversal, command injection, Log4Shell, SSRF and scanner paths."],
    ["Rate limiting & throttling", "live", "Per-account, per-IP and per-target limits, plus a global per-IP flood limit; breaches feed scraping alerts."],
    ["IP reputation scoring & geo-blocking", "live", "Score from your own history and the Tor exit list; add ABUSEIPDB_KEY for a threat feed. Country blocks and IP blocks are manual or automatic and expire."],
    ["Tarpitting", "live", "Tarpit rule slows every response from an abusive IP; risky native sign-ins are delayed."],
    ["Advanced CAPTCHAs", "setup", "Cloudflare Turnstile appears adaptively on sign-in and sign-up. Set TURNSTILE_SITE_KEY and TURNSTILE_SECRET."],
    ["Behavioural biometrics", "live", "Keystroke/pointer/timing signals are scored on sign-in and sign-up (web and native) and combined with IP reputation to trigger the CAPTCHA or a delay."],
    ["DDoS mitigation", "external", "Under-attack mode and a per-IP flood limit are built in. Absorbing volumetric attacks needs an edge network in front (Cloudflare proxy is the quickest); the guide has the steps."],
    ["Network segmentation / air-gapping", "external", "Infrastructure design: private database networking, no public DB port, egress allow-list. The guide gives the exact Fly/Postgres steps. The app already refuses to trust unverified database TLS when PGSSL_VERIFY is on."],
    ["Dynamic DOM obfuscation", "external", "Intentionally not implemented (hurts accessibility and SEO, easily bypassed)."],
  ]],
  ["4 · Detection, monitoring & response", [
    ["Deception (honeypots / honeytokens)", "live", "Decoy API key, admin token, admin account and three decoy endpoints. Any touch is a critical alert."],
    ["SIEM", "setup", "Alerts, containment and test events are forwarded as signed JSON to any SIEM webhook (Splunk, Datadog, Elastic, Sentinel…). Set SIEM_WEBHOOK_URL in the Vault or environment."],
    ["SOAR (automated response)", "live", "Playbooks propose or apply reversible containment, with a circuit breaker, kill switch and TTLs."],
    ["DLP fingerprinting", "live", "Every export carries a per-download fingerprint (invisible in text); Platform → Trace leaked content finds who downloaded it."],
    ["Canary deployments", "setup", "fly.toml now deploys with the canary strategy and health checks, so a bad release is stopped before it replaces healthy machines."],
    ["EDR / XDR", "external", "Agents on servers and staff laptops (Defender, CrowdStrike, SentinelOne). Their alerts can be forwarded into the same SIEM; steps in the guide."],
    ["Confidential computing", "external", "Needs secure-enclave hardware (Azure Confidential VMs, AWS Nitro, GCP Confidential VMs). Fly.io does not offer it; the guide explains when it is worth moving. The Vault is key-isolated in the meantime."],
  ]],
];
