"use client";
// Last resort if the root layout itself fails — plain, no dependencies.
export default function GlobalError({ reset }) {
  return (
    <html lang="en"><body style={{ margin: 0, background: "#0A0A0C", color: "#F2F2F4", fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 20 }}>
      <div>
        <h2 style={{ margin: "0 0 8px" }}>Something went wrong</h2>
        <p style={{ color: "#9A9AA4", margin: "0 0 20px" }}>Please try again in a moment.</p>
        <button onClick={reset} style={{ background: "#E8A317", color: "#0A0A0C", border: 0, borderRadius: 999, padding: "10px 24px", fontWeight: 700, cursor: "pointer" }}>Try again</button>
      </div>
    </body></html>
  );
}
