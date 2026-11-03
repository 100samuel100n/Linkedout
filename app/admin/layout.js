"use client";
import Logo from "@/components/Logo";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { C, displayFont, monoFont } from "@/lib/theme";
import { useAuth } from "@/app/auth-provider";
import { adminApi } from "@/components/admin/adminApi";
import TwoFactor from "@/components/admin/TwoFactor";
import { inputStyle } from "@/components/admin/ui";
import Loading from "@/components/ui/Loading";

import { AdminCtx } from "@/components/admin/AdminContext";

// Role gate for the whole /admin tree. The server re-checks the role on
// every /api/admin call — this layout only decides what to RENDER and where
// to redirect: signed-out → /login, signed-in non-staff → the normal feed.
export default function AdminLayout({ children }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [badges, setBadges] = useState({}), [sq, setSq] = useState(""), [hits, setHits] = useState(null);
  // Queue counts in the sidebar, refreshed every 30 s.
  useEffect(() => {
    if (!me?.twoFactor?.verified) return;
    const load = () => adminApi.get("badges").then(setBadges).catch(() => {});
    load(); const t = setInterval(load, 30000); return () => clearInterval(t);
  }, [me]);
  useEffect(() => {
    if (sq.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => adminApi.get(`gsearch?q=${encodeURIComponent(sq.trim())}`).then((r) => setHits(r.hits)).catch((e) => setHits([{ type: "Error", label: "Search unavailable", sub: "Try again", href: pathname }])), 250);
    return () => clearTimeout(t);
  }, [sq]);
  const BADGE = { reports: "reports", appeals: "appeals", verification: "verification", support: "support", adreview: "adreview", dm: "dm", companies: "companies", dmca: "dmca", legal: "legal" };

  const loadMe = () => adminApi.me().then((m) => (m.staff ? setMe(m) : router.replace("/"))).catch(() => router.replace("/"));
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (!user.isStaff) { router.replace("/"); return; }
    loadMe();
  }, [user, loading, router]);

  useEffect(() => setNavOpen(false), [pathname]);
  if (!me) return <div style={{ padding: 32, background: C.ink, minHeight: "100vh" }}><div className="lo-progress" /><div style={{ maxWidth: 720, margin: "0 auto" }}><Loading /></div></div>;
  if (!me.twoFactor?.verified) return <TwoFactor state={me.twoFactor} onDone={loadMe} />;

  const groups = [...new Set(me.sections.map((s) => s.group))];
  const href = (id) => (id === "overview" ? "/admin" : `/admin/${id}`);
  const active = (id) => (id === "overview" ? pathname === "/admin" : pathname === `/admin/${id}`);

  const nav = (
    <nav style={{ width: 256, flexShrink: 0, background: C.surface, borderRight: `1px solid ${C.line}`, padding: 14, overflowY: "auto", height: "100vh", position: "sticky", top: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 8px 4px" }}><Logo size={28} /><div><div style={{ fontSize: 16, fontWeight: 750, color: C.text, letterSpacing: "-0.02em", lineHeight: 1.1 }}>Linkedout</div><div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>Admin console</div></div></div>
      <div style={{ fontSize: 13, color: C.muted, padding: "6px 8px 10px" }}>{me.pseudonym} <span className="lo-badge" style={{ marginLeft: 4 }}>{me.role.replace("_", " ")}</span></div>
      {groups.map((g) => (
        <div key={g}>
          <div className="lo-eyebrow" style={{ padding: "16px 10px 6px" }}>{g}</div>
          {me.sections.filter((s) => s.group === g).map((s) => (
            <Link key={s.id} href={href(s.id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 9, fontSize: 14, fontWeight: active(s.id) ? 650 : 500, textDecoration: "none", color: active(s.id) ? C.mustard : C.text2, background: active(s.id) ? "var(--lo-accent-soft)" : "transparent", boxShadow: active(s.id) ? "inset 3px 0 0 var(--lo-mustard)" : "none", transition: "background .15s, color .15s" }} className="lo-row-hover">
              <span>{s.label}</span>
              {badges[BADGE[s.id]] > 0 && <span style={{ ...monoFont, fontSize: 12, fontWeight: 700, background: C.flag, color: "#fff", borderRadius: 99, padding: "1px 7px" }}>{badges[BADGE[s.id]] > 99 ? "99+" : badges[BADGE[s.id]]}</span>}
            </Link>
          ))}
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14, paddingTop: 10, display: "grid", gap: 6 }}>
        <button onClick={async () => { await logout(); router.replace("/login"); }} style={{ textAlign: "left", fontSize: 13, color: C.muted, background: "none", border: 0, padding: "4px 10px", cursor: "pointer" }}>Log out</button>
      </div>
    </nav>
  );

  return (
    <AdminCtx.Provider value={me}>
      <div style={{ display: "flex", minHeight: "100vh", background: C.ink, color: C.text }}>
        <div className="hidden md:block">{nav}</div>
        {navOpen && <div className="md:hidden" style={{ position: "fixed", inset: 0, zIndex: 50, background: "#0008" }} onClick={() => setNavOpen(false)}><div onClick={(e) => e.stopPropagation()}>{nav}</div></div>}
        <main style={{ flex: 1, minWidth: 0, padding: "0 24px 56px", maxWidth: 1280 }}>
          <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.ink, padding: "12px 0", marginBottom: 6, borderBottom: `1px solid ${C.line}`, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 520 }}>
              <input value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && hits?.[0]) { router.push(hits[0].href); setSq(""); setHits(null); } if (e.key === "Escape") { setSq(""); setHits(null); } }} placeholder="Search users, posts, companies, vent rooms, ads, tickets…" style={{ ...inputStyle, paddingLeft: 12 }} />
              {hits && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, maxHeight: 360, overflowY: "auto", boxShadow: "0 12px 30px rgba(0,0,0,.35)" }}>
                  {hits.length === 0 && <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>No matches.</div>}
                  {hits.map((h, i) => <Link key={i} href={h.href} onClick={() => { setSq(""); setHits(null); }} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "8px 12px", textDecoration: "none", color: C.text, borderBottom: `1px solid ${C.line}`, fontSize: 13 }}><span style={{ ...monoFont, fontSize: 12, color: C.muted, width: 56 }}>{h.type}</span><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.label}</span><span style={{ color: C.muted, fontSize: 12 }}>{h.sub}</span></Link>)}
                </div>
              )}
            </div>
            <span style={{ ...monoFont, fontSize: 12, color: C.muted, whiteSpace: "nowrap" }}>{me.pseudonym} · {me.role.replace("_", " ")}</span>
          </div>
          <button className="md:hidden" onClick={() => setNavOpen(true)} style={{ marginBottom: 10, background: C.surface, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px" }}>☰ Menu</button>
          {children}
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
