import { contentDb } from "@/lib/content/db";
import { renderCard, CARD_SIZE } from "@/lib/share-card";
export const size = CARD_SIZE; export const contentType = "image/png"; export const alt = "A post on LinkedOut";
export default async function Image({ params }) {
  const { id } = await params;
  const p = await contentDb.prepare("SELECT text, author_display, cringe_nominated, cringe_votes, comment_count, cry, laugh, skull, flag, visibility, scheduled_at FROM posts WHERE id = ?").get(id).catch(() => null);
  const hidden = !p || p.visibility === "removed" || (p.scheduled_at && p.scheduled_at > new Date().toISOString());
  if (hidden) return renderCard({ kind: "pulse", kicker: "Pulse", text: "Say the quiet part out loud.", author: "LinkedOut" });
  const react = (+p.cry || 0) + (+p.laugh || 0) + (+p.skull || 0) + (+p.flag || 0), award = !!p.cringe_nominated;
  return renderCard({ kind: award ? "award" : "pulse", kicker: award ? "Cringe Awards" : "Pulse", text: p.text, author: p.author_display, badge: award ? `On the cringe board · ${+p.cringe_votes || 0} votes` : null, stats: [react ? `${react} reactions` : "", +p.comment_count ? `${p.comment_count} replies` : ""] });
}
