"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { C, monoFont, displayFont, alpha } from "@/lib/theme";
import ErrorNote from "@/components/ErrorNote";

const HEX = /^#[0-9a-fA-F]{6}$/;
function safeUrl(u) { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; } }

// Full page ad: a branded landing page opened from a feed ad.
export default function AdPage() {
  const { id } = useParams();
  const [ad, setAd] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch(`/api/ads/${id}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setAd(j); }).catch((e) => setError(e.message));
  }, [id]);
  if (error) return <div className="flex flex-col gap-3"><Link href="/" style={{ ...monoFont, fontSize: 12, color: C.muted, textDecoration: "none" }}><ChevronLeft size={13} style={{ display: "inline" }} /> Back</Link><ErrorNote>{error}</ErrorNote></div>;
  if (!ad) return <div className="lo-skeleton" style={{ height: 260 }} />;
  const accent = HEX.test(ad.accent_color || "") ? ad.accent_color : C.corpblue;
  const hero = safeUrl(ad.page.image || ad.image_url || "");
  const dest = safeUrl(ad.url);
  const paras = String(ad.page.body || "").split(/\n{2,}/).filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <Link href="/" style={{ ...monoFont, fontSize: 12, color: C.muted, textDecoration: "none" }}><ChevronLeft size={13} style={{ display: "inline" }} /> Back to feed</Link>
      <article style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden" }}>
        {hero && <img src={hero} alt="" style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }} />}
        <div className="p-5 flex flex-col gap-3">
          <span style={{ ...monoFont, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted }}>{ad.label || "Sponsored"} · {ad.brand}</span>
          <h1 style={{ ...displayFont, fontSize: 22, fontWeight: 800, color: C.text }}>{ad.page.title}</h1>
          {paras.map((p, i) => <p key={i} style={{ fontSize: 14, color: C.muted, lineHeight: 1.65 }}>{p}</p>)}
          {dest && <a href={dest} target="_blank" rel="sponsored noopener noreferrer" onClick={() => fetch("/api/ads/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adId: ad.id, kind: "click" }), keepalive: true }).catch(() => {})} style={{ ...monoFont, alignSelf: "flex-start", fontSize: 12.5, color: "#fff", background: accent, borderRadius: 10, padding: "10px 18px", textDecoration: "none", fontWeight: 700 }}>{ad.page.cta}</a>}
        </div>
      </article>
    </div>
  );
}
