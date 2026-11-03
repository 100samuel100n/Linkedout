import { notFound } from "next/navigation";
import { getStory } from "@/lib/stories/service";
import { getAppUrl } from "@/lib/config";
import StoryView from "@/components/stories/StoryView";

// Server-rendered so search engines receive the story itself (not an empty shell), with
// correct metadata and structured data. Anything private, removed or opted out is noindex.
const base = () => getAppUrl().replace(/\/$/, "");
const clip = (t, n) => { const x = String(t || "").replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1).trim()}…` : x; };

export async function generateMetadata({ params }) {
  const { id } = await params;
  const s = await getStory(id, null).catch(() => null);
  if (!s) return { title: "Story not found", robots: { index: false, follow: false } };
  const title = s.title || `${s.formatLabel}${s.company ? ` at ${s.company}` : ""}`;
  const description = clip(s.body, 158);
  const url = `${base()}/stories/${id}`;
  return {
    title, description, alternates: { canonical: url },
    robots: s.noindex || s.status !== "published" ? { index: false, follow: true } : { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
    openGraph: { type: "article", title, description, url, siteName: "LinkedOut", publishedTime: s.createdAt },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function Page({ params }) {
  const { id } = await params;
  const s = await getStory(id, null).catch(() => null);
  if (!s) notFound();
  const ld = s.noindex ? null : {
    "@context": "https://schema.org", "@type": "DiscussionForumPosting",
    headline: clip(s.title || s.formatLabel, 110), text: clip(s.body, 1200), datePublished: s.createdAt, url: `${base()}/stories/${id}`,
    author: { "@type": "Person", name: s.author },
    ...(s.company ? { about: { "@type": "Organization", name: s.company } } : {}),
    interactionStatistic: [{ "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: s.counts.total }],
    isPartOf: { "@type": "WebSite", name: "LinkedOut", url: base() },
  };
  return (<>
    {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
    <StoryView id={id} initial={s} />
  </>);
}
