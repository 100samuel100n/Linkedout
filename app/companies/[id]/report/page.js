"use client";
import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import Loading from "@/components/ui/Loading";
import ErrorNote from "@/components/ErrorNote";
import { ReportBody } from "@/components/company-suite/ReportsTab";

// A clean, printable report. Use the browser's Print → Save as PDF.
function Report({ id }) {
  const sp = useSearchParams(); const [r, setR] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { api.suite(id, "reports", { from: sp.get("from") || "", to: sp.get("to") || "" }).then(setR).catch((e) => setErr(e.message)); }, [id, sp]);
  if (err) return <ErrorNote>{err}</ErrorNote>;
  if (!r) return <Loading variant="cards" />;
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>{r.company}: reputation report</h1>
      <div style={{ opacity: 0.7, marginBottom: 16 }}>{r.from} to {r.to} · LinkedOut</div>
      <ReportBody r={r} />
      <button className="lo-btn lo-btn-primary print:hidden" style={{ marginTop: 16 }} onClick={() => window.print()}>Print / save as PDF</button>
    </div>
  );
}
export default function Page({ params }) { const { id } = use(params); return <Suspense fallback={<Loading variant="cards" />}><Report id={id} /></Suspense>; }
