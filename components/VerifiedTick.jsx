"use client";
// X-style verified tick. OUT+ gets a clean blue seal; OUT PRO gets a richer
// gold seal with a gradient and a soft glow so it reads as the higher tier.
// OUT (basic) renders nothing.
export default function VerifiedTick({ tier, size = 15 }) {
  if (tier !== "plus" && tier !== "pro") return null;
  const pro = tier === "pro";
  const id = `vt-${tier}`;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" role="img"
      aria-label={pro ? "OUT PRO verified" : "OUT+ verified"}
      style={{ flexShrink: 0, marginLeft: 4, verticalAlign: "-3px", filter: pro ? "drop-shadow(0 0 3px rgba(232,170,30,.55))" : "none" }}
    >
      <title>{pro ? "OUT PRO" : "OUT+"}</title>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {pro ? (<><stop offset="0" stopColor="#FFE27A" /><stop offset="0.5" stopColor="#F2B01E" /><stop offset="1" stopColor="#C77D0A" /></>)
               : (<><stop offset="0" stopColor="#4DA3FF" /><stop offset="1" stopColor="#1D7AE8" /></>)}
        </linearGradient>
      </defs>
      <path
        fill={`url(#${id})`}
        d="M12 1.6l2.5 1.7 3-.2 1.4 2.7 2.7 1.4-.2 3L23 12l-1.6 2.5.2 3-2.7 1.4-1.4 2.7-3-.2L12 22.4l-2.5-1.6-3 .2-1.4-2.7-2.7-1.4.2-3L1 12l1.6-2.5-.2-3 2.7-1.4 1.4-2.7 3 .2z"
      />
      <path d="M7.6 12.3l3 3 5.9-6.2" fill="none" stroke={pro ? "#5A3A00" : "#fff"} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
