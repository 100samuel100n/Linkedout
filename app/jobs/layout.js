import { jobsEnabled } from "@/lib/flags";
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };
// While Jobs is paused (Admin -> Feed Controls, or JOBS_ENABLED=false) every /jobs page shows this notice instead.
export default async function JobsLayout({ children }) {
  if (await jobsEnabled()) return children;
  return (
    <div style={{ maxWidth: 520, margin: "60px auto", padding: 24, textAlign: "center" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Jobs is paused for now</h1>
      <p style={{ opacity: 0.75, lineHeight: 1.5 }}>We have switched the Jobs section off for a short while. Your saved jobs, applications and alerts are safe and will be back when it returns. Everything else on LinkedOut works as usual.</p>
      <a href="/" style={{ display: "inline-block", marginTop: 18, padding: "10px 18px", borderRadius: 10, border: "1px solid currentColor", textDecoration: "none", color: "inherit" }}>Back to stories</a>
    </div>
  );
}
