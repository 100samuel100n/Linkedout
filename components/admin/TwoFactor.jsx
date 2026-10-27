"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState, useEffect, useRef } from "react";
import { C, displayFont, monoFont } from "@/lib/theme";
import { adminApi } from "./adminApi";
import { btn, inputStyle, card } from "./ui";

// Gate shown before ANY admin data loads. Staff can use ANY enrolled method: authenticator app, emailed code,
// security key / passkey, or a one-time recovery code. First-time staff pick how to enrol.
export default function TwoFactor({ state = {}, onDone }) {
  const m = state.methods || {}, enabled = !!state.enabled;
  const [mode, setMode] = useState(null);            // enrol: "totp" | "email" · sign in: "totp" | "email" | "key" | "recovery"
  const [setup, setSetup] = useState(null), [code, setCode] = useState(""), [err, setErr] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [recovery, setRecovery] = useState(null), [sent, setSent] = useState(false);
  const started = useRef(false);

  const signInModes = [m.totp && ["totp", "Authenticator app"], m.email && ["email", "Email code"], m.key && ["key", "Security key"], m.recovery > 0 && ["recovery", "Recovery code"]].filter(Boolean);
  useEffect(() => { if (enabled && !mode && signInModes.length) setMode(signInModes[0][0]); }, [enabled]); // eslint-disable-line

  // Authenticator enrolment: fetch (or re-fetch) the pending secret ONCE per visit; the server now returns the same secret on reload.
  useEffect(() => {
    if (!enabled && mode === "totp" && !started.current) { started.current = true; adminApi.post("2fa/setup", {}).then(setSetup).catch((e) => setErr(e.message)); }
  }, [mode, enabled]);

  const go = async (fn) => { setBusy(true); setErr(""); setNote(""); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const pick = (k) => { setMode(k); setCode(""); setErr(""); setNote(""); setSent(false); if (k === "key") useKey(); };

  const sendCode = () => go(async () => { const r = await adminApi.post("2fa/email-send", {}); setSent(true); setNote(`We sent a 6-digit code to ${r.sentTo}. It expires in 10 minutes.`); });
  const submit = (e) => { e?.preventDefault(); go(async () => {
    let r;
    if (!enabled) r = await adminApi.post(mode === "email" ? "2fa/email-confirm" : "2fa/confirm", { code });
    else r = await adminApi.post("2fa/verify", { code, method: mode === "email" ? "email" : "auto" });
    if (r.recoveryCodes) setRecovery(r.recoveryCodes); else onDone();
  }); };
  const useKey = () => go(async () => {
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const o = await adminApi.post("2fa/webauthn-options", {});
      const response = await startAuthentication({ optionsJSON: o.options });
      await adminApi.post("2fa/webauthn-verify", { response, token: o.token });
      onDone();
    } catch (er) { throw new Error(er.name === "NotAllowedError" ? "The security key prompt was cancelled. Choose it again to retry." : er.message); }
  });

  const wrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.ink, padding: 16 };
  const pill = (on) => ({ ...btn(on ? "primary" : undefined), borderRadius: 999, padding: "6px 14px", minHeight: 34 });

  if (recovery) return (
    <div style={wrap}><div style={{ ...card, maxWidth: 440, width: "100%" }}>
      <h2 style={{ ...displayFont, marginTop: 0 }}>Save your recovery codes</h2>
      <p style={{ color: C.muted, fontSize: 13 }}>Each code works once if you lose access to your other methods. They won&apos;t be shown again.</p>
      <div style={{ ...monoFont, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, background: C.paper, color: "#111", padding: 12, borderRadius: 8 }}>{recovery.map((r) => <span key={r}>{r}</span>)}</div>
      <button style={{ ...btn("primary"), marginTop: 14, width: "100%", padding: 10 }} onClick={onDone}>I&apos;ve saved them. Continue</button>
    </div></div>
  );

  const needsCode = mode === "totp" || mode === "email" || mode === "recovery";
  return (
    <div style={wrap}><form onSubmit={submit} style={{ ...card, maxWidth: 440, width: "100%" }}>
      <h2 style={{ ...displayFont, marginTop: 0 }}>{enabled ? "Confirm it's you" : "Protect your staff account"}</h2>

      {!enabled && !mode && (
        <>
          <p style={{ color: C.muted, fontSize: 13 }}>Staff accounts need a second step at sign-in. Choose how you want to do it. You can add more methods later.</p>
          <button type="button" style={{ ...btn(), width: "100%", padding: 12, textAlign: "left", marginBottom: 8 }} onClick={() => pick("totp")}><b>Authenticator app</b><br /><span style={{ color: C.muted, fontSize: 12.5 }}>Google Authenticator, 1Password, Authy. Most secure of these two.</span></button>
          {state.emailAllowed && state.hasEmail && <button type="button" style={{ ...btn(), width: "100%", padding: 12, textAlign: "left" }} onClick={() => pick("email")}><b>Email code</b><br /><span style={{ color: C.muted, fontSize: 12.5 }}>We email a 6-digit code to {state.emailTo} each time.</span></button>}
        </>
      )}

      {enabled && signInModes.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{signInModes.map(([k, l]) => <button type="button" key={k} style={pill(mode === k)} onClick={() => pick(k)}>{l}</button>)}</div>}

      {mode === "totp" && !enabled && (
        <>
          <p style={{ color: C.muted, fontSize: 13 }}>In your authenticator app add a time-based account using this key, then enter the code it shows.</p>
          {setup ? <div style={{ ...monoFont, background: C.paper, color: "#111", padding: 10, borderRadius: 8, wordBreak: "break-all", fontSize: 14, marginBottom: 6 }}>{setup.secret}</div> : <p style={{ color: C.muted }}>Generating your key…</p>}
          {setup && <a href={setup.uri} style={{ fontSize: 12, color: C.corpblue }}>Open in authenticator app (on this device)</a>}
          {setup && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>This key stays the same if you reload this page. <button type="button" onClick={() => go(async () => setSetup(await adminApi.post("2fa/setup", { fresh: true })))} style={{ background: "none", border: "none", color: C.corpblue, cursor: "pointer", padding: 0, fontSize: 12 }}>Start over with a new key</button></div>}
        </>
      )}
      {mode === "totp" && enabled && <p style={{ color: C.muted, fontSize: 13 }}>Enter the 6-digit code from your authenticator app.</p>}
      {mode === "email" && (
        <>
          <p style={{ color: C.muted, fontSize: 13 }}>{sent ? "Enter the code we emailed you." : `We'll email a 6-digit code to ${state.emailTo || "your address"}.`}</p>
          <button type="button" style={{ ...btn(sent ? undefined : "primary"), width: "100%", padding: 10 }} disabled={busy} onClick={sendCode}>{sent ? "Send a new code" : "Email me a code"}</button>
        </>
      )}
      {mode === "recovery" && <p style={{ color: C.muted, fontSize: 13 }}>Enter one of your saved recovery codes. Each works once.</p>}
      {mode === "key" && <p style={{ color: C.muted, fontSize: 13 }}>{busy ? "Waiting for your security key or passkey…" : "Use your security key or passkey. Choose it again if the prompt closed."}</p>}

      {needsCode && (mode !== "email" || sent) && (
        <input autoFocus inputMode={mode === "recovery" ? "text" : "numeric"} autoComplete="one-time-code" placeholder={mode === "recovery" ? "recovery code" : "123456"} value={code} onChange={(e) => setCode(e.target.value)}
          style={{ ...inputStyle, marginTop: 12, fontSize: 18, letterSpacing: mode === "recovery" ? 1 : 4, textAlign: "center", width: "100%" }} />
      )}
      {note && <div style={{ color: C.green, fontSize: 13, marginTop: 8 }}>{note}</div>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {needsCode && (mode !== "email" || sent) && <button type="submit" disabled={busy || code.trim().length < 6} style={{ ...btn("primary"), marginTop: 12, width: "100%", padding: 10 }}>{enabled ? "Verify" : "Turn on"}</button>}
      {mode === "key" && <button type="button" onClick={useKey} disabled={busy} style={{ ...btn("primary"), marginTop: 8, width: "100%", padding: 10 }}>Use security key / passkey</button>}
      {!enabled && mode && <button type="button" onClick={() => { setMode(null); setErr(""); started.current = false; }} style={{ ...btn(), marginTop: 8, width: "100%", padding: 8 }}>Choose a different method</button>}
      {process.env.NEXT_PUBLIC_SSO_ENABLED === "true" && !enabled && <a href="/api/auth/sso/start" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, color: C.corpblue }}>Or sign in with company SSO</a>}
    </form></div>
  );
}
