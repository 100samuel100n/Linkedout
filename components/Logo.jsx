"use client";
// The door mark. The artwork is white, which disappears on a light background, so a navy
// twin is swapped in by CSS whenever the app is in light mode (see .lo-logo-* in globals.css).
export default function Logo({ size = 32, alt = "", style }) {
  const common = { width: size, height: size, alt, style: { display: "block", borderRadius: Math.round(size / 4), ...style } };
  return (
    <>
      <img src="/logo-mark.png" className="lo-logo-onDark" {...common} />
      <img src="/logo-mark-dark.png" className="lo-logo-onLight" {...common} />
    </>
  );
}
