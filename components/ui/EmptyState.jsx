"use client";
import Link from "next/link";

// Empty / error / locked states: one icon tile, a clear title, one sentence of
// help, and at most one action. Calm and consistent everywhere.
export default function EmptyState({ icon: Icon, title, children, actionLabel, href, onAction, tone = "neutral", compact = false }) {
  const accent = tone === "error" ? "var(--lo-flag)" : "var(--lo-mustard)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, padding: compact ? "28px 20px" : "52px 24px" }}>
      {Icon && (
        <div style={{ width: 48, height: 48, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: tone === "error" ? "color-mix(in srgb, var(--lo-flag) 14%, transparent)" : "var(--lo-accent-soft)", color: accent }}>
          <Icon size={22} strokeWidth={1.75} />
        </div>
      )}
      <div style={{ fontSize: 16, fontWeight: 650, color: "var(--lo-text)" }}>{title}</div>
      {children && <p style={{ margin: 0, maxWidth: 360, fontSize: 14, lineHeight: 1.55, color: "var(--lo-muted)" }}>{children}</p>}
      {actionLabel && (href
        ? <Link href={href} className="lo-btn lo-btn-primary" style={{ marginTop: 6, textDecoration: "none" }}>{actionLabel}</Link>
        : <button onClick={onAction} className="lo-btn lo-btn-primary" style={{ marginTop: 6 }}>{actionLabel}</button>)}
    </div>
  );
}
