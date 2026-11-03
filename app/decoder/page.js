import Link from "next/link";
import { GLOSSARY } from "@/lib/stories/glossary";
import { phraseSlug, kindLabel } from "@/lib/stories/seo";

export const metadata = { title: "Workplace phrase decoder: what job posting, HR and corporate phrases really mean", description: "Plain-English interpretations of phrases like 'we're like a family', 'fast-paced environment', 'right-sizing' and 'let's take this offline', with what to ask next.", alternates: { canonical: "/decoder" } };
export default function Decoder() {
  return (
    <div className="flex flex-col gap-5">
      <header><div className="lo-eyebrow" style={{ color: "var(--lo-mustard)" }}>Reality Translator</div><h1 style={{ margin: "4px 0", fontSize: 28, fontWeight: 780, letterSpacing: "-0.02em" }}>What workplace phrases really mean</h1><p style={{ margin: 0, color: "var(--lo-muted)", lineHeight: 1.6 }}>Interpretations of common language in job postings, HR messages, company announcements and meetings. They describe what a phrase often signals, not what any specific employer is doing. Always ask for specifics.</p></header>
      {Object.entries(GLOSSARY).map(([kind, list]) => (
        <section key={kind} className="lo-card" style={{ padding: 16 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 720 }}>{kindLabel(kind).replace(/^./, (c) => c.toUpperCase())} phrases</h2>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }} className="flex flex-col gap-1.5">{list.map(([phrase]) => <li key={phrase}><Link href={`/decoder/${phraseSlug(kind, phrase)}`} style={{ color: "var(--lo-text)", textDecoration: "none" }}>“{phrase}”</Link></li>)}</ul>
        </section>
      ))}
      <Link href="/translator" className="lo-btn lo-btn-primary" style={{ textDecoration: "none", alignSelf: "flex-start" }}>Translate your own phrase</Link>
    </div>
  );
}
