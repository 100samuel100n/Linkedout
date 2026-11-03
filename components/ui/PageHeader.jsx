"use client";
// Page title block used at the top of every screen so hierarchy is identical everywhere.
export default function PageHeader({ title, subtitle, actions, eyebrow }) {
  return (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 4 }}>
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="lo-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 750, color: "var(--lo-text)", letterSpacing: "-0.02em" }}>{title}</h1>
        {subtitle && <p style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "var(--lo-muted)" }}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{actions}</div>}
    </header>
  );
}
