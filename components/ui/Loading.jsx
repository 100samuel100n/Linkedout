"use client";
// Loading states. Never bare "loading…" text: content-shaped skeletons for
// lists/pages (so the layout does not jump when data arrives), a quiet spinner
// for inline/action waits. All are announced to assistive tech.

export function Skeleton({ w = "100%", h = 14, r = 8, style }) {
  return <div className="lo-skeleton" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function Spinner({ size = "md", label = "Loading" }) {
  return <span className={`lo-spinner ${size === "sm" ? "lo-spinner-sm" : ""}`} role="status" aria-label={label} style={{ display: "inline-block" }} />;
}

function Row({ avatar = true }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px" }}>
      {avatar && <Skeleton w={40} h={40} r={20} style={{ flexShrink: 0 }} />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton w="42%" h={13} />
        <Skeleton w="78%" h={12} />
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="lo-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Skeleton w={36} h={36} r={18} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}><Skeleton w="30%" h={12} /><Skeleton w="18%" h={10} /></div>
      </div>
      <Skeleton h={12} /><Skeleton w="92%" h={12} /><Skeleton w="64%" h={12} />
    </div>
  );
}

// variant: "page" (default) | "list" | "cards" | "inline" | "block"
export default function Loading({ variant = "page", rows = 4, label = "Loading" }) {
  if (variant === "inline") return <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--lo-muted)", fontSize: 14 }}><Spinner size="sm" label={label} /></span>;
  if (variant === "block") return <div style={{ display: "flex", justifyContent: "center", padding: 28 }}><Spinner label={label} /></div>;
  if (variant === "list") {
    return (
      <div aria-busy="true" aria-live="polite" role="status" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => <Row key={i} />)}
      </div>
    );
  }
  if (variant === "cards") {
    return (
      <div aria-busy="true" role="status" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {Array.from({ length: Math.min(rows, 3) }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    );
  }
  return (
    <div aria-busy="true" role="status" aria-label={label} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Skeleton w="38%" h={22} r={8} />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
