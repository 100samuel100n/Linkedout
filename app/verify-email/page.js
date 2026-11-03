"use client";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { C, monoFont, displayFont } from "@/lib/theme";
import { api } from "@/lib/api";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState("verifying"); // verifying | success | error
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) {
      setState("error");
      setError("Missing verification token.");
      return;
    }
    api.verifyEmail(token)
      .then(() => setState("success"))
      .catch((e) => { setState("error"); setError(e.message); });
  }, [token]);

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ ...displayFont, fontSize: 22, color: C.text }}>Email verification</div>
      {state === "verifying" && <p style={{ ...monoFont, fontSize: 12.5, color: C.muted }}>verifying…</p>}
      {state === "success" && <p style={{ fontSize: 13.5, color: C.green }}>Your email is verified. Thanks!</p>}
      {state === "error" && <ErrorNote>{error}</ErrorNote>}
      <Link href="/profile" style={{ ...monoFont, fontSize: 12, color: C.mustard }}>Go to your profile</Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
