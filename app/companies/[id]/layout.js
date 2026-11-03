import { contentDb } from "@/lib/content/db";
import { getAppUrl } from "@/lib/config";

const base = () => getAppUrl().replace(/\/$/, "");
export async function generateMetadata({ params }) {
  const { id } = await params;
  const c = await contentDb.prepare("SELECT * FROM companies WHERE id = ? AND status = 'active'").get(id).catch(() => null);
  if (!c) return { title: "Company", robots: { index: false } };
  const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM stories WHERE status='published' AND (company_id = ? OR company_key = ?)").get(id, c.name_norm).catch(() => ({ n: 0 }))).n);
  const title = `What employees say about ${c.name}: stories, layoffs and workplace reality`;
  const description = `${n ? `${n} first-hand stories from people who worked at, interviewed at or were laid off by ${c.name}.` : `Real experiences from ${c.name} employees and applicants.`} Layoff reports, interview and salary reality, patterns and the company's own responses. Not a rating.`;
  const url = `${base()}/companies/${id}`;
  return { title, description, alternates: { canonical: url }, openGraph: { type: "website", title, description, url, siteName: "LinkedOut" }, twitter: { card: "summary_large_image", title, description }, robots: n > 0 ? { index: true, follow: true } : { index: false, follow: true } };   // thin pages with no stories stay out of the index
}
export default async function Layout({ children, params }) {
  const { id } = await params;
  const c = await contentDb.prepare("SELECT name, industry, website FROM companies WHERE id = ? AND status = 'active'").get(id).catch(() => null);
  const ld = c && { "@context": "https://schema.org", "@type": "Organization", name: c.name, ...(c.website ? { url: /^https?:/.test(c.website) ? c.website : `https://${c.website}` } : {}), ...(c.industry ? { industry: c.industry } : {}) };
  return (<>{ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}{children}</>);
}
