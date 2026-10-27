"use client";
import ErrorNote from "@/components/ErrorNote";
import { useState } from "react";
import Link from "next/link";
import { C, monoFont, displayFont } from "@/lib/theme";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.requestPasswordReset(email);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22, color: C.text }}>Reset your password</div>
      {done ? (
        <p style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5 }}>
          If that email has an account, a reset link is on its way. Check your inbox (and spam folder).
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email" required placeholder="your account email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 8, padding: "10px 12px", fontSize: 13.5 }}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <button
            type="submit" disabled={busy}
            style={{ ...monoFont, fontSize: 12.5, color: "#FFFFFF", background: C.mustard, border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 700 }}
          >{busy ? "sending…" : "Send reset link"}</button>
        </form>
      )}
      <Link href="/login" style={{ ...monoFont, fontSize: 12, color: C.mustard }}>Back to log in</Link>
    </div>
  );
}
