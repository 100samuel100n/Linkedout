"use client";
import { useBehavior } from "@/lib/behavior";
import Turnstile from "@/components/security/Turnstile";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import LegalLinks from "@/components/LegalLinks";
import PlayStoreSoon from "@/components/PlayStoreSoon";
import { C, monoFont, displayFont } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import OAuthButtons from "@/components/OAuthButtons";
import { useDialog } from "@/components/Dialog";

const OAUTH_ERROR_MESSAGES = {
  oauth_state_mismatch: "That sign-in attempt expired or was tampered with — try again.",
  oauth_failed: "Sign-in didn't go through. Try again, or use email + password.",
  account_restricted: "This account is currently suspended or locked. Sign in with your email and password to see the details or appeal.",
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(OAUTH_ERROR_MESSAGES[searchParams.get("error")] || null);
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();
  const [code, setCode] = useState(null);       // ACCOUNT_RESTRICTED | PASSWORD_RESET_REQUIRED
  const [appealing, setAppealing] = useState(false);
  const [appealText, setAppealText] = useState("");
  // Two-factor step: set when the server asks for a code (password login, or Google/Apple redirect with ?mfa=)
  const [challenge, setChallenge] = useState(searchParams.get("mfa") || null);
  const [mfaCode, setMfaCode] = useState("");

  async function submitMfa(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/auth/login/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge, code: mfaCode }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { if (data.code === "CHALLENGE_EXPIRED") { setChallenge(null); setMfaCode(""); } throw new Error(data.error || "Couldn't verify that code."); }
      const me = await refresh();
      router.push(me?.isStaff ? "/admin" : "/");
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function sendAppeal() {
    setBusy(true);
    try {
      const res = await fetch("/api/appeals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, message: appealText }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't send your appeal.");
      setAppealing(false); setAppealText("");
      await dialog.alert({ title: "Appeal sent", message: "Our team will review it and notify you here and by notification once decided." });
    } catch (err) { dialog.alert({ title: "Couldn't send your appeal", message: err.message }); } finally { setBusy(false); }
  }

  const readBehavior = useBehavior();
  const [captchaKey, setCaptchaKey] = useState(null), [captchaToken, setCaptchaToken] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, bx: readBehavior(), captchaToken: captchaToken || undefined }),
      });
      const data = await res.json();
      if (res.status === 428 && data.siteKey) { setCaptchaKey(data.siteKey); setCaptchaToken(""); throw new Error("Please complete the check below, then log in again."); }
      if (!res.ok) { setCode(data.code || null); throw new Error(data.error || "Login failed."); }
      setCode(null);
      if (data.twoFactorRequired) { setChallenge(data.challenge); return; }
      const me = await refresh();
      // Staff are sent straight to the admin dashboard; everyone else to the feed.
      router.push(me?.isStaff ? "/admin" : "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "10px 12px", fontSize: 13.5 };

  if (challenge) {
    return (
      <form onSubmit={submitMfa} className="flex flex-col gap-4" style={{ maxWidth: 360, margin: "0 auto" }}>
        <div style={{ ...displayFont, fontSize: 22, color: C.text }}>Two-factor check</div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Enter the 6-digit code from your authenticator app, or one of your recovery codes.</div>
        <input autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} style={{ ...inputStyle, fontSize: 20, letterSpacing: 4, textAlign: "center" }} />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy || mfaCode.trim().length < 6} style={{ ...monoFont, fontSize: 12.5, color: "#fff", background: C.mustard, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700, opacity: mfaCode.trim().length < 6 ? 0.5 : 1 }}>{busy ? "Verifying…" : "Verify and log in"}</button>
        <button type="button" onClick={() => { setChallenge(null); setMfaCode(""); setError(null); }} style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none" }}>← Back</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22, color: C.text }}>Log in</div>

      <OAuthButtons />
      <div className="flex items-center gap-3" style={{ ...monoFont, fontSize: 12, color: C.muted }}>
        <div style={{ flex: 1, height: 1, background: C.line }} /> or <div style={{ flex: 1, height: 1, background: C.line }} />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email" required placeholder="work or personal email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password" required placeholder="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        {code === "PASSWORD_RESET_REQUIRED" && <Link href="/forgot-password" style={{ ...monoFont, fontSize: 12, color: C.mustard }}>Reset your password →</Link>}
        {code === "ACCOUNT_RESTRICTED" && !appealing && (
          <button type="button" onClick={() => setAppealing(true)} style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "transparent", border: `1px solid ${C.mustard}`, borderRadius: 8, padding: "8px 12px" }}>Appeal this decision</button>
        )}
        {code === "ACCOUNT_RESTRICTED" && appealing && (
          <div className="flex flex-col gap-2">
            <textarea rows={4} maxLength={2000} value={appealText} onChange={(e) => setAppealText(e.target.value)} placeholder="Tell us why this decision should be reconsidered" style={inputStyle} />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setAppealing(false)} style={{ ...monoFont, fontSize: 12, color: C.text, background: "transparent", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px" }}>Cancel</button>
              <button type="button" disabled={busy || !appealText.trim()} onClick={sendAppeal} style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.mustard, border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, opacity: appealText.trim() ? 1 : 0.5 }}>Send appeal</button>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Link href="/forgot-password" style={{ ...monoFont, fontSize: 12, color: C.muted }}>Forgot password?</Link>
        </div>
        {captchaKey && <Turnstile siteKey={captchaKey} onToken={setCaptchaToken} />}
        <button
          type="submit" disabled={busy}
          style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}
        >{busy ? "logging in…" : "Log in"}</button>
        {process.env.NEXT_PUBLIC_SSO_ENABLED === "true" && <a href="/api/auth/sso/start" style={{ fontSize: 13, color: C.mustard, textAlign: "center" }}>Staff single sign-on</a>}
      </form>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>
        No account? <Link href="/signup" style={{ color: C.mustard }}>Sign up</Link>
      </div>
      <PlayStoreSoon variant="line" style={{ marginBottom: 10 }} />
      <LegalLinks />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LoginForm />
    </Suspense>
  );
}
