"use client";
import { useState } from "react";
import { C } from "@/lib/theme";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import ErrorNote from "@/components/ErrorNote";

export default function Redeem() {
  const [code, setCode] = useState(""); const [err, setErr] = useState(null);
  async function go() { try { const r = await api.redeemRepInvite(code); window.location.href = `/companies/${r.companyId}`; } catch (e) { setErr(e.message); } }
  return <div className="flex flex-col gap-4"><PageHeader eyebrow="Company representatives" title="Redeem an invite" subtitle="Paste the code the page owner gave you. You'll be able to reply to stories for the company." />
    <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Invite code" style={{ background: C.surface2, border: `1px solid ${C.line}`, color: C.text, borderRadius: 10, padding: 12, fontSize: 15 }} />
    {err && <ErrorNote>{err}</ErrorNote>}<div><button className="lo-btn lo-btn-primary" disabled={code.length < 8} onClick={go}>Redeem</button></div></div>;
}
