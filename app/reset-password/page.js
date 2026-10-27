"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Smartphone } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import { api } from "@/lib/api";

// If this page ever loads at all on a phone, it means the OS didn't hand
// the tap straight to the native app via a Universal/App Link — either
// the app isn't installed, or (very likely while linkedout.app's real
// domain + signing cert aren't wired into apple-app-site-association /
// assetlinks.json yet, see those files' own comments) verification just
// hasn't gone through. Either way, offer a one-tap custom-scheme handoff
// instead of leaving them stuck finishing the reset in a mobile browser.
function OpenInAppBanner({ token }) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);
  if (!isMobile || !token) return null;
  return (
    <a
      href={`linkedout://reset-password?token=${encodeURIComponent(token)}`}
      className="lo-tap flex items-center gap-2"
      style={{
        ...monoFont, fontSize: 12, color: C.mustard, textDecoration: "none",
        background: alpha(C.mustard, 10), border: `1px solid ${alpha(C.mustard, 30)}`,
        borderRadius: 8, padding: "10px 12px",
      }}
    >
      <Smartphone size={14} /> Open in the LinkedOut app instead
    </a>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!token) {
      setError("Missing reset token — use the link from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22, color: C.text }}>Choose a new password</div>
      <OpenInAppBanner token={token} />
      {done ? (
        <p style={{ fontSize: 13.5, color: C.green, lineHeight: 1.5 }}>Password updated — redirecting to login…</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password" required placeholder="new password (8+ characters)" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "10px 12px", fontSize: 13.5 }}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <button
            type="submit" disabled={busy}
            style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}
          >{busy ? "updating…" : "Update password"}</button>
        </form>
      )}
      <Link href="/login" style={{ ...monoFont, fontSize: 12, color: C.mustard }}>Back to log in</Link>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
