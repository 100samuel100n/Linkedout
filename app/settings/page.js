"use client";
import Loading from "@/components/ui/Loading";
import EmptyState from "@/components/ui/EmptyState";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";
import { ComingSoonAppleButton } from "@/components/OAuthButtons";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  UserCog, Lock, Bell, Sun, Moon, Monitor, Check, AlertTriangle, Phone,
  BadgeCheck, Building2, Briefcase, Clock, Download, UserX, Trash2, ChevronLeft, Upload, Volume2, VolumeX, Play, Mail, ShieldCheck,
} from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import QrCode from "@/components/QrCode";
import { useDialog } from "@/components/Dialog";
import { useTheme } from "@/app/theme-provider";
import { api } from "@/lib/api";
import { INTERESTS, ACCOUNT_TYPES } from "@/lib/data";
import { TONES } from "@/lib/sound-tones";
import { getSoundPrefs, updateSoundPrefs, subscribeSoundPrefs, previewTone, playSound, pullSoundPrefs } from "@/lib/sounds";

const CATEGORIES = [
  { key: "account", label: "Your Account", icon: UserCog },
  { key: "security", label: "Security & Verification", icon: Lock },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "messaging", label: "Messaging", icon: Mail },
  { key: "sounds", label: "Sounds", icon: Volume2 },
  { key: "appearance", label: "Appearance", icon: Sun },
  { key: "data", label: "Deactivate & Delete", icon: UserX },
  { key: "legal", label: "Legal & Policies", icon: ShieldCheck },
  { key: "support", label: "Help & Support", icon: Mail },
];

// Security-sensitive actions (password change, deactivate, delete) ask for a fresh
// authenticator code whenever two-factor is on. The server enforces it as well.
async function askStepUp(dialog, user) {
  if (!user?.twoFactorEnabled) return { ok: true, code: undefined };
  const code = await dialog.prompt({
    title: "Confirm it's you",
    message: "Enter the 6-digit code from your authenticator app, or one of your recovery codes, to continue.",
    placeholder: "123456",
    confirmLabel: "Continue",
  });
  if (!code || !code.trim()) return { ok: false };
  return { ok: true, code: code.trim() };
}

// Everyone, with or without two-factor, confirms deactivating or deleting the account with a
// 6-digit code emailed to the address on the account (the Google address for Google sign-ups).
// A wrong code can be retried without sending another email; an expired or locked one is re-sent.
async function askEmailCode(dialog, purpose, state) {
  if (state.needsNewCode !== false) {
    try {
      const sent = await api.sendActionCode(purpose);
      dialog.toast(`Code sent to ${sent.sentTo}`);
      state.needsNewCode = false;
      state.sentTo = sent.sentTo;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  const code = await dialog.prompt({
    title: "Check your email",
    message: `Enter the 6-digit code we sent to ${state.sentTo || "your email"}. It expires in 10 minutes.`,
    placeholder: "123456",
    confirmLabel: "Continue",
  });
  if (!code || !code.trim()) return { ok: false, cancelled: true };
  return { ok: true, code: code.trim() };
}
// Only a wrong code keeps the same email; anything else needs a fresh one next time.
const keepsCode = (e) => e?.code === "EMAIL_CODE_INVALID";

const inputStyle = { background: C.surface2, border: `1px solid ${C.line2}`, color: C.text, borderRadius: 10, padding: "10px 12px", fontSize: 15, width: "100%", minHeight: 42 };

export default function SettingsPage() {
  const { user, loading, refresh, logout } = useAuth();
  const [category, setCategory] = useState("account");
  // Deep links like /settings#notifications or #sounds open that tab.
  useEffect(() => {
    const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    if (CATEGORIES.some((c) => c.key === h)) setCategory(h);
  }, []);

  if (loading) return <Loading />;
  if (!user) {
    return <EmptyState icon={Lock} title="Log in to see settings" actionLabel="Log in" href="/login">Your account, privacy and notification preferences live here.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Account" title="Settings & Privacy" subtitle="Manage your identity, security, notifications and how Linkedout looks." />

      <div className="flex flex-col md:flex-row gap-5 md:gap-8 items-start">
        <nav aria-label="Settings sections" className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible w-full md:w-52" style={{ flexShrink: 0, position: "sticky", top: 8 }}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => (c.key === "support" ? (window.location.href = "/support") : setCategory(c.key))}
                aria-current={active ? "page" : undefined}
                className="flex items-center gap-2.5 lo-row-hover"
                style={{
                  fontSize: 14.5, fontWeight: active ? 650 : 500, color: active ? C.mustard : C.text2, background: active ? "var(--lo-accent-soft)" : "transparent", border: "none",
                  borderRadius: 10, padding: "10px 12px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, textAlign: "left",
                }}
              ><Icon size={17} strokeWidth={active ? 2.2 : 1.8} /> {c.label}</button>
            );
          })}
        </nav>
        <div className="flex flex-col gap-5 flex-1 min-w-0 w-full">

      {category === "account" && <AccountCategory key={JSON.stringify([user.pseudonym, user.realName, user.bio, user.country, user.accountType, user.interests])} user={user} refresh={refresh} />}
      {category === "security" && <SecurityCategory user={user} refresh={refresh} />}
      {category === "notifications" && <NotificationsCategory />}
      {category === "messaging" && <MessagingCategory />}
      {category === "sounds" && <SoundsCategory />}
      {category === "appearance" && <AppearanceCategory />}
      {category === "data" && <DataCategory logout={logout} />}
      {category === "legal" && <LegalCategory />}
        </div>
      </div>
    </div>
  );
}

function LegalCategory() {
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 2px", borderBottom: `1px solid ${C.line}`, color: C.text, textDecoration: "none", fontSize: 14.5 };
  return (
    <SettingsCard title="Legal & Policies" icon={ShieldCheck}>
      <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>LinkedOut is an independent platform, not affiliated with any other company or service. We keep your data secure and never sell it.</p>
      <div>
        <Link href="/terms" style={row}>Terms of Use <span style={{ color: C.muted }}>›</span></Link>
        <Link href="/privacy" style={row}>Privacy Policy <span style={{ color: C.muted }}>›</span></Link>
        <Link href="/legal/dmca" style={row}>Copyright notice <span style={{ color: C.muted }}>›</span></Link>
      </div>
    </SettingsCard>
  );
}

function SettingsCard({ title, icon: Icon, children }) {
  return (
    <section className="lo-card p-5 md:p-6 flex flex-col gap-5">
      <div className="flex items-center gap-2.5" style={{ fontSize: 16, fontWeight: 650, color: C.text, letterSpacing: "-0.01em" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--lo-accent-soft)", color: C.mustard }}><Icon size={16} /></span> {title}
      </div>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------
   YOUR ACCOUNT — profile fields, all with cooldown awareness
--------------------------------------------------------- */
function CooldownNotice({ cooldown, fieldLabel }) {
  if (!cooldown) return null;
  return (
    <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.mustard, background: alpha(C.mustard, 8), border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 8, padding: "8px 10px" }}>
      <Clock size={12} />
      You can change your {fieldLabel} again on {new Date(cooldown.nextAllowedAt).toLocaleDateString()} ({cooldown.remainingDays} day{cooldown.remainingDays === 1 ? "" : "s"} left).
    </div>
  );
}

function AccountCategory({ user, refresh }) {
  const [pseudonym, setPseudonym] = useState(user.pseudonym);
  const [realName, setRealName] = useState(user.realName);
  const [bio, setBio] = useState(user.bio || "");
  const [country, setCountry] = useState(user.country || "");
  const [accountType, setAccountType] = useState(user.accountType || "personal");
  const [interests, setInterests] = useState(user.interests || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const cooldowns = user.cooldowns || {};
  const pseudonymLocked = !!cooldowns.pseudonym;
  const realNameLocked = !!cooldowns.realName;

  const dirty = pseudonym !== user.pseudonym || realName !== user.realName || bio !== (user.bio || "")
    || country !== (user.country || "") || accountType !== user.accountType
    || JSON.stringify(interests) !== JSON.stringify(user.interests || []);

  function toggleInterest(i) {
    setInterests((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : prev.length < 5 ? [...prev, i] : prev));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateProfile({ pseudonym, realName, bio, country, accountType, interests });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsCard title="Your Account" icon={UserCog}>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 4 }}>PSEUDONYM — visible to everyone, unique like a username</div>
        <input value={pseudonym} onChange={(e) => setPseudonym(e.target.value)} style={inputStyle} maxLength={24} disabled={pseudonymLocked} />
        <div style={{ marginTop: 6 }}>
          {pseudonymLocked ? <CooldownNotice cooldown={cooldowns.pseudonym} fieldLabel="pseudonym" /> : (
            <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Can be changed once every 14 days.</div>
          )}
        </div>
      </div>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 4 }}>REAL NAME — only shown if you post as "Real Name"</div>
        <input value={realName} onChange={(e) => setRealName(e.target.value)} style={inputStyle} maxLength={80} disabled={realNameLocked} />
        <div style={{ marginTop: 6 }}>
          {realNameLocked ? <CooldownNotice cooldown={cooldowns.realName} fieldLabel="real name" /> : (
            <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Can be changed once every 14 days.</div>
          )}
        </div>
      </div>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 4 }}>BIO ({bio.length}/280)</div>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} style={{ ...inputStyle, resize: "none" }} rows={3} maxLength={280} />
      </div>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 4 }}>COUNTRY</div>
        <input value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle} maxLength={60} />
      </div>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 6 }}>ACCOUNT TYPE</div>
        <div className="flex gap-2">
          {ACCOUNT_TYPES.map((t) => (
            <button
              key={t.key} onClick={() => setAccountType(t.key)}
              style={{ ...monoFont, fontSize: 12, flex: 1, padding: "8px", borderRadius: 8, border: `1px solid ${accountType === t.key ? C.mustard : C.line}`, color: accountType === t.key ? C.mustard : C.muted, background: accountType === t.key ? alpha(C.mustard, 8) : "transparent", cursor: "pointer" }}
            >{t.label}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 6 }}>INTERESTS (up to 5)</div>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map((i) => {
            const active = interests.includes(i);
            return (
              <button
                key={i} onClick={() => toggleInterest(i)}
                style={{ ...monoFont, fontSize: 12, padding: "4px 10px", borderRadius: 20, border: `1px solid ${active ? C.mustard : C.line}`, color: active ? C.mustard : C.muted, background: active ? alpha(C.mustard, 8) : "transparent", cursor: "pointer" }}
              >{i}</button>
            );
          })}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="lo-on-color"
          disabled={!dirty || saving}
          style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: dirty ? C.mustard : C.surface2, border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: dirty ? "pointer" : "default" }}
        >{saving ? <Loading variant="inline" /> : "Save changes"}</button>
        {saved && <span className="flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.green }}><Check size={13} /> saved</span>}
      </div>
    </SettingsCard>
  );
}

/* ---------------------------------------------------------
   SECURITY & VERIFICATION
--------------------------------------------------------- */
function SecurityCategory({ user, refresh }) {
  return (
    <div className="flex flex-col gap-4">
      <PasswordSection user={user} />
      <TwoFactorSection user={user} refresh={refresh} />
      <EmailPhoneSection user={user} refresh={refresh} />
      <IdentityVerificationSection user={user} refresh={refresh} />
      <ConnectedAccountsSection user={user} refresh={refresh} />
    </div>
  );
}

function TwoFactorSection({ user, refresh }) {
  const dialog = useDialog();
  const [step, setStep] = useState("idle"); // idle | setup | codes | disable
  const [setup, setSetup] = useState(null), [code, setCode] = useState(""), [pw, setPw] = useState(""), [codes, setCodes] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const post = (body) => fetch("/api/auth/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; });
  const input = { background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "9px 12px", fontSize: 13.5, width: "100%" };
  const btn = (primary) => ({ ...monoFont, fontSize: 12, fontWeight: 700, borderRadius: 8, padding: "8px 14px", cursor: "pointer", color: primary ? "#fff" : C.text, background: primary ? C.mustard : "transparent", border: `1px solid ${primary ? C.mustard : C.line}` });
  const run = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };

  return (
    <SettingsCard title="Two-factor authentication" icon={ShieldCheck}>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>Require a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy…) when you log in, on top of your password.</div>
      {step === "idle" && (user.twoFactorEnabled
        ? <div className="flex items-center justify-between gap-3 flex-wrap"><span style={{ ...monoFont, fontSize: 12, color: C.green }}>● On</span><button style={btn(false)} onClick={() => { setStep("disable"); setCode(""); setPw(""); setErr(null); }}>Turn off</button></div>
        : <div><button style={btn(true)} disabled={busy} onClick={() => run(async () => { setSetup(await post({ action: "setup" })); setCode(""); setStep("setup"); })}>Set up two-factor</button></div>)}
      {step === "setup" && setup && (
        <div className="flex flex-col gap-3">
          <div style={{ fontSize: 13, color: C.text }}>1. Scan this QR code with your authenticator app:</div>
          <QrCode value={setup.uri} />
          <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Can't scan? Enter this key manually: <b style={{ color: C.text, wordBreak: "break-all" }}>{setup.secret}</b></div>
          <div style={{ fontSize: 13, color: C.text }}>2. Enter the 6-digit code it shows:</div>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} style={{ ...input, letterSpacing: 4, textAlign: "center", fontSize: 18 }} />
          <div className="flex gap-2"><button style={btn(false)} onClick={() => setStep("idle")}>Cancel</button><button style={btn(true)} disabled={busy || code.trim().length < 6} onClick={() => run(async () => { const r = await post({ action: "enable", code }); setCodes(r.recoveryCodes); setStep("codes"); await refresh(); })}>Turn on</button></div>
        </div>
      )}
      {step === "codes" && codes && (
        <div className="flex flex-col gap-3">
          <div style={{ fontSize: 13, color: C.text }}>Two-factor is on. Save these recovery codes somewhere safe — each works once if you lose your phone. They won't be shown again.</div>
          <div style={{ ...monoFont, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, background: C.surface2, padding: 12, borderRadius: 8, color: C.text }}>{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div><button style={btn(true)} onClick={() => { setCodes(null); setStep("idle"); dialog.toast("Two-factor is on."); }}>I've saved them</button></div>
        </div>
      )}
      {step === "disable" && (
        <div className="flex flex-col gap-3">
          <input type="password" placeholder="Your password" value={pw} onChange={(e) => setPw(e.target.value)} style={input} />
          <input inputMode="numeric" placeholder="Authenticator or recovery code" value={code} onChange={(e) => setCode(e.target.value)} style={input} />
          <div className="flex gap-2"><button style={btn(false)} onClick={() => setStep("idle")}>Cancel</button><button style={{ ...btn(true), background: C.flag, borderColor: C.flag }} disabled={busy || !code.trim()} onClick={() => run(async () => { await post({ action: "disable", password: pw, code }); setStep("idle"); await refresh(); dialog.toast("Two-factor turned off."); })}>Turn off</button></div>
        </div>
      )}
      {err && <ErrorNote>{err}</ErrorNote>}
    </SettingsCard>
  );
}

function PasswordSection({ user }) {
  const dialog = useDialog();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState(null);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwSaved, setPwSaved] = useState(false);

  async function changePassword() {
    setPwError(null);
    const step = await askStepUp(dialog, user);
    if (!step.ok) return;
    setPwSaving(true);
    try {
      await api.changePassword(currentPassword, newPassword, step.code);
      setCurrentPassword(""); setNewPassword("");
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 2500);
    } catch (e) {
      setPwError(e.message);
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <SettingsCard title="Password" icon={Lock}>
      {user.hasPassword ? (
        <div className="flex flex-col gap-2">
          <input type="password" placeholder="current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="new password (8+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} />
          {pwError && <ErrorNote>{pwError}</ErrorNote>}
          <div className="flex items-center gap-3">
            <button
              onClick={changePassword}
              disabled={!currentPassword || newPassword.length < 8 || pwSaving}
              style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", alignSelf: "flex-start" }}
            >{pwSaving ? <Loading variant="inline" /> : "Update password"}</button>
            {pwSaved && <span className="flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.green }}><Check size={13} /> updated</span>}
          </div>
        </div>
      ) : (
        <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>
          This account signed up via {user.hasGoogle ? "Google" : "Apple"} and has no password to change.
        </div>
      )}
    </SettingsCard>
  );
}

function EmailPhoneSection({ user, refresh }) {
  const [resendState, setResendState] = useState("idle");
  const [phone, setPhone] = useState(user.phone || "");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState(user.phoneVerified ? "verified" : "enter-phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [smsNote, setSmsNote] = useState(null);

  async function resendVerification() {
    setResendState("sending");
    try { await api.resendVerification(); setResendState("sent"); } catch { setResendState("idle"); }
  }
  async function requestCode() {
    if (!phone.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await api.requestPhoneVerification(phone.trim());
      setStage("enter-code");
      setSmsNote(`Code sent. It expires in ${Math.round((res.expiresInSec || 600) / 60)} minutes.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function confirmCode() {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { await api.confirmPhoneVerification(code.trim()); await refresh(); setStage("verified"); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <SettingsCard title="Email & Phone" icon={Phone}>
      <div className="flex items-center justify-between">
        <div>
          <div style={{ fontSize: 13, color: C.text }}>{user.email}</div>
          <div style={{ ...monoFont, fontSize: 12, color: user.emailVerified ? C.green : C.flag, marginTop: 2 }}>{user.emailVerified ? "verified" : "not verified"}</div>
        </div>
        {!user.emailVerified && (
          <button onClick={resendVerification} disabled={resendState !== "idle"} style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "none", border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            {resendState === "sent" ? "sent!" : resendState === "sending" ? "sending…" : "resend"}
          </button>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginBottom: 8 }}>PHONE (OPTIONAL)</div>
        {stage === "verified" ? (
          <div className="flex items-center gap-2" style={{ fontSize: 13, color: C.green }}><Check size={14} /> {user.phone} verified</div>
        ) : stage === "enter-code" ? (
          <div className="flex flex-col gap-2">
            {smsNote && <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{smsNote}</div>}
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" maxLength={6} style={inputStyle} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <button onClick={confirmCode} disabled={!code.trim() || busy} style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", alignSelf: "flex-start" }}>{busy ? "verifying…" : "Confirm code"}</button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" style={inputStyle} />
            {error && <ErrorNote>{error}</ErrorNote>}
            <button onClick={requestCode} disabled={!phone.trim() || busy} style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", alignSelf: "flex-start" }}>{busy ? "sending…" : "Send code"}</button>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

const VERIFICATION_TYPES = [
  { key: "government_id", label: "Government ID", icon: BadgeCheck, hint: "Upload a clear photo of a government-issued ID (passport, driver's license, national ID). Cover any info you don't want a reviewer to see except what proves your identity." },
  { key: "business", label: "Business", icon: Building2, hint: "Upload a business registration document, or add a note with your work email domain / a link proving your role." },
  { key: "professional", label: "Professional", icon: Briefcase, hint: "Upload a license, certificate, or add a note with a professional-profile or portfolio link proving your professional claim." },
];

function VerificationRow({ type, status, refresh }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  async function submit() {
    if (!notes.trim() && !file) return;
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.set("type", type.key);
      form.set("notes", notes.trim());
      if (file) form.set("document", file);
      await api.submitVerificationRequest(form);
      await refresh();
      setOpen(false);
      setNotes("");
      setFile(null);
    }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const statusColor = status === "verified" ? C.green : status === "pending" ? C.mustard : status === "rejected" ? C.flag : C.muted;
  const statusLabel = status === "verified" ? "verified" : status === "pending" ? "pending review" : status === "rejected" ? "rejected" : "not verified";
  const Icon = type.icon;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} color={C.muted} />
          <span style={{ fontSize: 13, color: C.text }}>{type.label}</span>
          <span style={{ ...monoFont, fontSize: 12, color: statusColor }}>· {statusLabel}</span>
        </div>
        {status === "none" || status === "rejected" ? (
          <button onClick={() => setOpen((o) => !o)} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.mustard, background: "none", border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>request</button>
        ) : status === "pending" ? <Clock size={13} color={C.mustard} /> : <Check size={14} color={C.green} />}
      </div>
      {open && (
        <div className="lo-enter flex flex-col gap-2.5" style={{ background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{type.hint}</div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="lo-tap flex items-center gap-2"
            style={{
              ...monoFont, fontSize: 12, color: file ? C.text : C.muted, background: C.surface, border: `1.5px dashed ${file ? C.mustard : C.line}`,
              borderRadius: 8, padding: "12px 14px", cursor: "pointer", textAlign: "left",
            }}
          >
            <Upload size={14} color={file ? C.mustard : C.muted} />
            {file ? file.name : "Upload a photo or PDF"}
          </button>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ display: "none" }} />

          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note for the reviewer" rows={2} maxLength={400} style={{ ...inputStyle, resize: "none" }} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <button onClick={submit} disabled={(!notes.trim() && !file) || busy} className="lo-tap flex items-center gap-1.5" style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", alignSelf: "flex-start", fontWeight: 700 }}>
            {busy && <Upload size={12} className="lo-spin" />} {busy ? "submitting…" : "Submit for review"}
          </button>
        </div>
      )}
    </div>
  );
}

function IdentityVerificationSection({ user, refresh }) {
  const [history, setHistory] = useState(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    api.getVerificationRequests().then((r) => setHistory(r.requests || r)).catch(() => setHistory([]));
  }, [user.governmentIdStatus, user.businessVerifiedStatus, user.professionalVerifiedStatus]);

  const typeLabel = { government_id: "Government ID", business: "Business", professional: "Professional" };

  return (
    <SettingsCard title="Identity Verification" icon={BadgeCheck}>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>
        Reviewed by a human operator, not instant. Submitting doesn't reveal anything to other users; only your verified badge (if approved) becomes visible.
      </div>
      <VerificationRow type={VERIFICATION_TYPES[0]} status={user.governmentIdStatus} refresh={refresh} />
      <VerificationRow type={VERIFICATION_TYPES[1]} status={user.businessVerifiedStatus} refresh={refresh} />
      <VerificationRow type={VERIFICATION_TYPES[2]} status={user.professionalVerifiedStatus} refresh={refresh} />

      {history && history.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 8, marginTop: 4 }}>
          <button onClick={() => setShowHistory((s) => !s)} className="lo-tap flex items-center gap-1" style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: "none", cursor: "pointer" }}>
            {showHistory ? "Hide" : "View"} submission history ({history.length})
          </button>
          {showHistory && (
            <div className="lo-enter flex flex-col gap-2" style={{ marginTop: 8 }}>
              {history.map((r) => (
                <div key={r.id} style={{ background: C.surface2, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                  <div className="flex items-center justify-between">
                    <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{typeLabel[r.type] || r.type}</span>
                    <span style={{
                      ...monoFont, fontSize: 12,
                      color: r.status === "approved" ? C.green : r.status === "rejected" ? C.flag : C.mustard,
                    }}>{r.status}</span>
                  </div>
                  <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>submitted {new Date(r.created_at).toLocaleDateString()}</span>
                  {r.review_note && <span style={{ fontSize: 12, color: C.muted, fontStyle: "italic" }}>Reviewer note: {r.review_note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}

function ConnectedAccountsSection({ user }) {
  return (
    <SettingsCard title="Connected Accounts" icon={BadgeCheck}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 13, color: C.text }}>Google</span>
        {user.hasGoogle ? <span style={{ ...monoFont, fontSize: 12, color: C.green }}>connected</span> : (
          <a href="/api/auth/google" style={{ ...monoFont, fontSize: 12, color: C.mustard, border: `1px solid ${alpha(C.mustard, 33)}`, borderRadius: 8, padding: "6px 10px", textDecoration: "none" }}>connect</a>
        )}
      </div>
      <div className="flex items-center justify-between">
        <ComingSoonAppleButton compact />
      </div>
    </SettingsCard>
  );
}

/* ---------------------------------------------------------
   NOTIFICATIONS
--------------------------------------------------------- */
function NotificationsCategory() {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    api.getNotificationPreferences().then((r) => setPrefs(r.categories)).catch((e) => setError(e.message));
  }, []);

  async function toggle(category, channel) {
    const current = prefs[category];
    const next = { ...current, [channel]: !current[channel] };
    setPrefs((p) => ({ ...p, [category]: next }));
    setSavingKey(`${category}:${channel}`);
    try {
      await api.setNotificationPreference(category, { [channel]: next[channel] });
    } catch (e) {
      setPrefs((p) => ({ ...p, [category]: current })); // revert on failure
      setError(e.message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <SettingsCard title="Notifications" icon={Bell}>
      <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, marginBottom: 4 }}>
        Choose where each kind of notification reaches you. Turning off a category doesn't retroactively delete past notifications, and never reveals who triggered one — just that something happened.
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!prefs ? (
        <div className="flex flex-col gap-2">
          <div className="lo-skeleton" style={{ height: 48 }} />
          <div className="lo-skeleton" style={{ height: 48 }} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2" style={{ padding: "4px 0" }}>
            <span />
            {["inApp", "email", "push"].map((ch) => (
              <span key={ch} style={{ ...monoFont, fontSize: 12, color: C.muted, textAlign: "center", width: 46, textTransform: "uppercase" }}>
                {ch === "inApp" ? "App" : ch}
              </span>
            ))}
          </div>
          {Object.entries(prefs).map(([key, cat]) => (
            <div key={key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2" style={{ padding: "8px 0", borderTop: `1px solid ${C.line}` }}>
              <div>
                <div style={{ fontSize: 12.5, color: C.text }}>{cat.label}</div>
                <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 1 }}>{cat.description}</div>
              </div>
              {["inApp", "email", "push"].map((ch) => (
                <button
                  key={ch}
                  onClick={() => toggle(key, ch)}
                  disabled={savingKey === `${key}:${ch}`}
                  className="lo-tap"
                  style={{
                    width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer", position: "relative",
                    background: cat[ch] ? C.mustard : C.surface2, justifySelf: "center",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, left: cat[ch] ? 20 : 2, width: 18, height: 18, borderRadius: "50%",
                    background: "#FFFFFF", transition: "left 0.15s ease",
                  }} />
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  );
}

/* ---------------------------------------------------------
   APPEARANCE
--------------------------------------------------------- */
function AppearanceCategory() {
  const { mode, setMode } = useTheme();
  const OPTIONS = [
    { key: "system", label: "System", icon: Monitor },
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <SettingsCard title="Appearance" icon={Sun}>
      <div className="flex gap-2">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const active = mode === o.key;
          return (
            <button
              key={o.key} onClick={() => setMode(o.key)}
              className="flex-1 flex flex-col items-center gap-1.5"
              style={{ padding: "12px 8px", borderRadius: 8, border: `1px solid ${active ? C.mustard : C.line}`, background: active ? alpha(C.mustard, 8) : "transparent", cursor: "pointer" }}
            >
              <Icon size={16} color={active ? C.mustard : C.muted} />
              <span style={{ ...monoFont, fontSize: 12, color: active ? C.mustard : C.muted }}>{o.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Changes apply instantly, everywhere in the app.</div>
    </SettingsCard>
  );
}

/* ---------------------------------------------------------
   YOUR DATA & ACCOUNT — export, deactivate, delete
--------------------------------------------------------- */
function DataCategory({ logout }) {
  return (
    <div className="flex flex-col gap-4">
      {/* "Download your data" is paused for now (the /api/profile/export route is kept
          so it can be switched back on). Re-add a SettingsCard here to bring it back. */}
      <DeactivateSection />
      <DeleteSection logout={logout} />
    </div>
  );
}

function DeactivateSection() {
  const { user, logout } = useAuth();
  const dialog = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const codeState = useRef({});

  async function handleDeactivate() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const mail = await askEmailCode(dialog, "deactivate", codeState.current);
    if (!mail.ok) { if (mail.error) setError(mail.error); setBusy(false); return; }
    const step = await askStepUp(dialog, user);
    if (!step.ok) { setBusy(false); return; }
    try {
      await api.deactivateAccount(password, step.code, mail.code);
    } catch (e) {
      setError(e.message);
      if (!keepsCode(e)) codeState.current.needsNewCode = true;
      setBusy(false);
      return;
    }
    // The server has already ended the session. Sign out locally without waiting on
    // it (a slow or failed call must never leave the button stuck), tell the person,
    // then leave the page.
    dialog.toast("Account deactivated. Log in any time to reactivate it.");
    Promise.resolve().then(() => logout()).catch(() => {});
    setTimeout(() => window.location.replace("/"), 900);
  }

  return (
    <SettingsCard title="Deactivate Account" icon={UserX}>
      <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
        Temporarily disables your account and logs you out everywhere. Logging back in with your password reactivates it automatically — nothing is deleted. Your posts stay in the feed either way, since they were never linked back to your account in the first place.
      </p>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", alignSelf: "flex-start" }}>Deactivate account</button>
      ) : (
        <div className="flex flex-col gap-2">
          {user?.hasPassword && <input type="password" placeholder="confirm your password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />}
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>For your security we'll email a 6-digit code to the address on your account to confirm.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex gap-2 items-center">
            <button onClick={handleDeactivate} className="lo-on-color" disabled={busy || (user?.hasPassword && !password)} style={{ ...monoFont, fontSize: 12, color: "#FFFFFF", background: C.corpblue, border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 8 }}>{busy && <Loading variant="inline" />}Confirm deactivation</button>
            <button onClick={() => { setConfirming(false); setPassword(""); setError(null); }} disabled={busy} style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

function DeleteSection({ logout }) {
  const { user } = useAuth();
  const dialog = useDialog();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const codeState = useRef({});

  async function handleDelete() {
    if (deleting) return;
    setError(null);
    setDeleting(true);
    const mail = await askEmailCode(dialog, "delete", codeState.current);
    if (!mail.ok) { if (mail.error) setError(mail.error); setDeleting(false); return; }
    const step = await askStepUp(dialog, user);
    if (!step.ok) { setDeleting(false); return; }
    try {
      await api.deleteAccount(password, step.code, mail.code);
    } catch (e) {
      setError(e.message);
      if (!keepsCode(e)) codeState.current.needsNewCode = true;
      setDeleting(false);
      return;
    }
    dialog.toast("Your account has been deleted.");
    Promise.resolve().then(() => logout()).catch(() => {});
    setTimeout(() => window.location.replace("/"), 900);
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${alpha(C.flag, 40)}`, borderRadius: 10 }} className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2" style={{ ...monoFont, fontSize: 12, color: C.flag, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        <Trash2 size={13} /> Delete account
      </div>
      {!confirming ? (
        <button onClick={() => setConfirming(true)} style={{ ...monoFont, fontSize: 12, color: C.flag, background: "none", border: `1px solid ${alpha(C.flag, 40)}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer", alignSelf: "flex-start" }}>Delete account</button>
      ) : (
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.5 }}>
            Unlike deactivating, this cannot be undone. Deletes your account, profile, avatar, and notifications permanently. Posts you've already made stay in the feed — they were never linked back to your account in the first place.
          </p>
          {user?.hasPassword && <input type="password" placeholder="confirm your password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />}
          <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>For your security we'll email a 6-digit code to the address on your account before anything is deleted.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex items-center gap-2">
            <button onClick={handleDelete} className="lo-on-color" disabled={deleting || (user?.hasPassword && !password)} style={{ ...monoFont, fontSize: 12, color: "#fff", background: C.flag, border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>{deleting ? <Loading variant="inline" /> : "Permanently delete"}</button>
            <button onClick={() => { setConfirming(false); setPassword(""); setError(null); }} style={{ ...monoFont, fontSize: 12, color: C.muted, background: "none", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 14px", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}


/* ---------------------------------------------------------
   SOUNDS — on/off, volume, tone for notifications and messages
--------------------------------------------------------- */
function Toggle({ on, onChange, label, sub }) {
  return (
    <div className="flex items-center justify-between gap-4" style={{ minHeight: 44 }}>
      <div>
        <div style={{ fontSize: 15, color: C.text, fontWeight: 500 }}>{label}</div>
        {sub && <div style={{ fontSize: 13.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      <button
        role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        style={{ width: 46, height: 26, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", flexShrink: 0, background: on ? "var(--lo-grad)" : C.surface3, transition: "background .18s" }}
      >
        <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .18s", boxShadow: "0 1px 3px rgba(0,0,0,.35)" }} />
      </button>
    </div>
  );
}

function TonePicker({ label, value, onPick, disabled }) {
  return (
    <div className="flex flex-col gap-2" style={{ opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {TONES.map((t) => {
          const active = value === t.id;
          return (
            <div key={t.id} className="flex items-center gap-2" style={{ border: `1px solid ${active ? C.mustard : C.line}`, background: active ? alpha(C.mustard, 8) : "transparent", borderRadius: 10, padding: "8px 10px" }}>
              <button onClick={() => onPick(t.id)} aria-pressed={active} className="lo-tap" style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: active ? 700 : 500, display: "flex", alignItems: "center", gap: 5 }}>{t.label}{active && <Check size={12} color={C.mustard} />}</div>
                <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{t.desc}</div>
              </button>
              <button onClick={() => previewTone(t.id)} aria-label={`Preview ${t.label}`} className="lo-tap" style={{ width: 28, height: 28, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.surface2, color: C.muted, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Play size={11} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SoundsCategory() {
  const [p, setP] = useState(getSoundPrefs());
  useEffect(() => { pullSoundPrefs(); return subscribeSoundPrefs(setP); }, []);
  const set = (changes) => updateSoundPrefs(changes);

  return (
    <div className="flex flex-col gap-4">
      <SettingsCard title="Sound" icon={p.enabled ? Volume2 : VolumeX}>
        <Toggle on={p.enabled} onChange={(v) => { set({ enabled: v }); if (v) setTimeout(() => playSound("notify"), 60); }} label="Notification sounds" sub="Master switch — off means no sound for notifications or messages." />
        <div style={{ opacity: p.enabled ? 1 : 0.45 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <label htmlFor="vol" style={{ fontSize: 13, color: C.text }}>Volume</label>
            <span style={{ ...monoFont, fontSize: 12, color: C.muted }}>{p.volume}%</span>
          </div>
          <input
            id="vol" type="range" min={0} max={100} step={5} value={p.volume} disabled={!p.enabled}
            onChange={(e) => setP({ ...p, volume: Number(e.target.value) })}
            onPointerUp={(e) => { set({ volume: Number(e.currentTarget.value) }); previewTone(p.tone); }}
            onKeyUp={(e) => { set({ volume: Number(e.currentTarget.value) }); previewTone(p.tone); }}
            style={{ width: "100%", accentColor: C.mustard }}
          />
          <div style={{ ...monoFont, fontSize: 12, color: C.muted, marginTop: 4 }}>Sets how loud sounds are on this device while LinkedOut is open. Push notifications follow your device volume.</div>
        </div>
      </SettingsCard>

      <SettingsCard title="Notification tone" icon={Bell}>
        <TonePicker label="General notifications" value={p.tone} onPick={(id) => { set({ tone: id }); previewTone(id); }} disabled={!p.enabled} />
      </SettingsCard>

      <SettingsCard title="Message tone" icon={Bell}>
        <TonePicker label="New messages" value={p.messageTone} onPick={(id) => { set({ messageTone: id }); previewTone(id); }} disabled={!p.enabled} />
      </SettingsCard>

      <SettingsCard title="Extras" icon={Volume2}>
        <Toggle on={p.roomCues} onChange={(v) => set({ roomCues: v })} label="Vent Room cues" sub="A soft sound when someone joins or leaves, and when a session ends." />
        <Toggle on={p.appSounds} onChange={(v) => set({ appSounds: v })} label="App sounds" sub="Subtle sounds for sending and receiving messages." />
      </SettingsCard>
    </div>
  );
}


/* ---------------------------------------------------------
   MESSAGING — who can reach you, receipts, typing, blocked list
--------------------------------------------------------- */
function MessagingCategory() {
  const [prefs, setPrefs] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.getDmPrefs().then(setPrefs).catch((e) => setErr(e.message)); api.getBlocks().then(setBlocks).catch(() => setBlocks([])); }, []);
  const save = async (changes) => { setPrefs((p) => ({ ...p, ...changes })); try { setPrefs(await api.updateDmPrefs(changes)); } catch (e) { setErr(e.message); } };
  const WHO = [["everyone", "Everyone", "Anyone can send you a request"], ["following", "People I follow", "Only people you follow can send a request"], ["nobody", "Nobody", "You won't receive new requests"]];
  if (!prefs) return <Loading />;
  return (
    <div className="flex flex-col gap-4">
      <SettingsCard title="Who can message you" icon={Mail}>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Who can message you">
          {WHO.map(([k, l, d]) => (
            <button key={k} role="radio" aria-checked={prefs.who === k} onClick={() => save({ who: k })} className="lo-tap text-left" style={{ cursor: "pointer", background: prefs.who === k ? alpha(C.mustard, 8) : "transparent", border: `1px solid ${prefs.who === k ? C.mustard : C.line}`, borderRadius: 12, padding: "10px 14px" }}>
              <div style={{ fontSize: 13.5, color: C.text, fontWeight: prefs.who === k ? 700 : 500 }}>{l}</div>
              <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>{d}</div>
            </button>
          ))}
        </div>
        <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>Either way, a first message is only a request — you accept or decline before anything else can be sent.</div>
      </SettingsCard>
      <SettingsCard title="Chat privacy" icon={Mail}>
        <Toggle on={prefs.readReceipts} onChange={(v) => save({ readReceipts: v })} label="Read receipts" sub="Show when you've read a message. Turning this off also hides theirs from you." />
        <Toggle on={prefs.typing} onChange={(v) => save({ typing: v })} label="Typing indicator" sub="Show when you're typing. Turning this off also hides theirs from you." />
      </SettingsCard>
      <SettingsCard title="Blocked" icon={UserX}>
        {blocks === null ? <Loading /> : blocks.length === 0 ? <div style={{ ...monoFont, fontSize: 12, color: C.muted }}>You haven't blocked anyone.</div> : blocks.map((b) => (
          <div key={b.handle} className="flex items-center justify-between gap-3">
            <span style={{ fontSize: 13.5, color: C.text }}>{b.displayLabel}</span>
            <button onClick={async () => { await api.unblockHandle(b.handle).catch(() => {}); setBlocks(blocks.filter((x) => x.handle !== b.handle)); }} className="lo-tap" style={{ ...monoFont, fontSize: 12, color: C.text, background: "none", border: `1px solid ${C.line}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>Unblock</button>
          </div>
        ))}
      </SettingsCard>
      <div style={{ ...monoFont, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>Messages are encrypted at rest and shown only between aliases. Notifications never include message text. Disappearing-message timers can be set per chat.</div>
    </div>
  );
}
