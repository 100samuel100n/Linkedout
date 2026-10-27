"use client";
import { useEffect, useRef, useState } from "react";
import { Globe, Smartphone, Monitor } from "lucide-react";
import { C } from "@/lib/theme";
import { adminApi } from "@/components/admin/adminApi";
import { card, LiveDot } from "@/components/admin/ui";

const since = (iso, now = Date.now()) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const flag = (code) => (/^[A-Z]{2}$/.test(code || "") ? String.fromCodePoint(...[...code].map((c) => 127397 + c.charCodeAt(0))) : "🌐");

// Real-time "who is here right now", refreshed every 5 seconds. Pulsing dot = active this moment.
export default function LivePanel() {
  const [d, setD] = useState(null), [err, setErr] = useState(""), [bump, setBump] = useState(0);
  const prev = useRef(null), [, tick] = useState(0), skew = useRef(0), okAt = useRef(0);
  // The feed counts as stale if the last good refresh is older than 15s; then we say so instead of showing a confident, wrong number.
  const stale = !!d && Date.now() - okAt.current > 15000;
  useEffect(() => {
    let dead = false;
    const load = () => adminApi.get("live").then((x) => {
      if (dead) return;
      if (prev.current !== null && prev.current !== x.total) setBump((b) => b + 1);
      prev.current = x.total; skew.current = x.at ? new Date(x.at).getTime() - Date.now() : 0; okAt.current = Date.now(); setD(x); setErr("");
    }).catch((e) => !dead && setErr(e.message));
    load();
    const a = setInterval(load, 5000), b = setInterval(() => tick((n) => n + 1), 1000);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => { dead = true; clearInterval(a); clearInterval(b); document.removeEventListener("visibilitychange", vis); };
  }, []);

  const Chip = ({ icon: Icon, label, n }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 12px" }}>
      <Icon size={16} color={C.muted} />
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
      <b style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{n}</b>
    </div>
  );

  return (
    <div className="lo-rise" style={{ ...card, padding: 0, overflow: "hidden", background: `linear-gradient(135deg, color-mix(in srgb, var(--lo-green) 9%, ${C.surface}), ${C.surface} 55%)` }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14, borderRight: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: C.green }}>
            <LiveDot size="lg" off={(!!err && !d) || stale} /> Live now{stale ? " · reconnecting…" : ""}
          </div>
          <div key={bump} className="lo-bump" style={{ fontSize: 56, fontWeight: 850, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: C.text }}>{d ? d.total.toLocaleString() : "—"}</div>
          <div style={{ fontSize: 13.5, color: C.muted }}>{err && !d ? err : d ? `${d.last5min.toLocaleString()} active in the last 5 minutes` : "Connecting…"}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Chip icon={Monitor} label="Web" n={d?.web ?? 0} />
            <Chip icon={Smartphone} label="App" n={d?.app ?? 0} />
          </div>
          {d?.countries?.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: "flex", alignItems: "center", gap: 6 }}><Globe size={14} /> Where from</div>
              {d.countries.map((c) => (
                <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span style={{ width: 20 }}>{flag(c.code)}</span><span style={{ flex: 1 }}>{c.name}</span>
                  <div style={{ width: 70, height: 6, borderRadius: 6, background: C.surface2, overflow: "hidden" }}><div style={{ width: `${Math.max(8, (c.n / d.total) * 100)}%`, height: "100%", background: "var(--lo-grad)", borderRadius: 6, transition: "width .4s" }} /></div>
                  <b style={{ width: 26, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.n}</b>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: "16px 8px 8px 8px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, padding: "0 12px 8px" }}>Active people ({d?.users?.length ?? 0}{d && d.total > d.users.length ? ` of ${d.total}` : ""})</div>
          <div style={{ maxHeight: 340, overflowY: "auto", padding: "0 4px" }}>
            {d && d.users.length === 0 && <div style={{ padding: 16, fontSize: 13.5, color: C.muted }}>Nobody is on LinkedOut right this second.</div>}
            {d?.users.map((u) => (
              <a key={u.id} href={`/admin/users?open=${u.id}`} className="lo-row-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, textDecoration: "none", color: C.text }}>
                <LiveDot />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600 }}>{u.pseudonym}{u.role !== "user" && <span style={{ color: C.corpblue, fontWeight: 500 }}> · {u.role}</span>}</span>
                <span style={{ display: "flex", gap: 6, color: C.muted }}>{u.platforms.includes("web") && <Monitor size={14} aria-label="Web" />}{u.platforms.includes("app") && <Smartphone size={14} aria-label="App" />}</span>
                <span style={{ fontSize: 12.5, color: C.muted, minWidth: 64, textAlign: "right" }}>{u.city || (u.country ? flag(u.country) : "")}</span>
                <span style={{ fontSize: 12, color: C.muted, minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{since(u.since, Date.now() + skew.current)}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
