import Link from "next/link";
import { notFound } from "next/navigation";
import { GLOSSARY, SPEAK_DISCLAIMER } from "@/lib/stories/glossary";
import { findPhrase, relatedPhrases, phraseSlug, kindLabel } from "@/lib/stories/seo";

export function generateStaticParams() { return Object.entries(GLOSSARY).flatMap(([k, l]) => l.map(([p]) => ({ slug: phraseSlug(k, p) }))); }
export async function generateMetadata({ params }) {
  const { slug } = await params; const p = findPhrase(slug); if (!p) return { robots: { index: false } };
  const title = `What does “${p.phrase}” mean in a ${kindLabel(p.kind)} context?`;
  return { title, description: `${p.meaning} What to ask: ${p.ask}`.slice(0, 200), alternates: { canonical: `/decoder/${slug}` }, openGraph: { title, type: "article" } };
}
export default async function Page({ params }) {
  const { slug } = await params; const p = findPhrase(slug); if (!p) notFound();
  const rel = relatedPhrases(p.kind, p.phrase);
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
    { "@type": "Question", name: `What does “${p.phrase}” mean?`, acceptedAnswer: { "@type": "Answer", text: p.meaning } },
    { "@type": "Question", name: `What should I ask when I hear “${p.phrase}”?`, acceptedAnswer: { "@type": "Answer", text: p.ask } }] };
  return (
    <div className="flex flex-col gap-4">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <Link href="/decoder" style={{ color: "var(--lo-muted)", textDecoration: "none", fontSize: 13.5 }}>← All phrases</Link>
      <h1 style={{ margin: 0, fontSize: 28, fontWeight: 780, letterSpacing: "-0.02em" }}>What does “{p.phrase}” mean?</h1>
      <div className="lo-card" style={{ padding: 18 }}><div className="lo-eyebrow">Often means</div><p style={{ margin: "4px 0 0", fontSize: 17, lineHeight: 1.6 }}>{p.meaning}</p></div>
      <div className="lo-card" style={{ padding: 18 }}><div className="lo-eyebrow">Worth asking</div><p style={{ margin: "4px 0 0", fontSize: 16, lineHeight: 1.6 }}>{p.ask}</p></div>
      <p style={{ fontSize: 13, color: "var(--lo-muted)" }}>{SPEAK_DISCLAIMER}</p>
      {rel.length > 0 && <div><div className="lo-eyebrow" style={{ marginBottom: 6 }}>Related</div><ul style={{ margin: 0, padding: 0, listStyle: "none" }} className="flex flex-col gap-1">{rel.map((r) => <li key={r.slug}><Link href={`/decoder/${r.slug}`} style={{ color: "var(--lo-mustard)", textDecoration: "none" }}>“{r.phrase}”</Link></li>)}</ul></div>}
      <Link href="/" className="lo-btn lo-btn-secondary" style={{ textDecoration: "none", alignSelf: "flex-start" }}>Read what people say about real workplaces</Link>
    </div>
  );
}
