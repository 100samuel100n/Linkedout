import { getStory } from "@/lib/stories/service";
import { renderCard, CARD_SIZE } from "@/lib/share-card";
export const size = CARD_SIZE; export const contentType = "image/png"; export const alt = "A story on LinkedOut";
export default async function Image({ params }) {
  const { id } = await params;
  const s = await getStory(id, null).catch(() => null);
  if (!s || s.status !== "published") return renderCard({ kind: "story", kicker: "Story", text: "First-hand accounts from working life.", author: "LinkedOut" });
  return renderCard({ kind: "story", kicker: `${s.formatLabel || "Story"}${s.company ? ` · ${s.company}` : ""}`, text: s.title || s.body, author: s.author || "Anonymous", stats: [s.counts?.total ? `${s.counts.total} say this happened to them too` : "First-hand account"] });
}
