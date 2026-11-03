import { contentDb } from "@/lib/content/db";
import { cardMeta } from "@/lib/share-card";
// Server wrapper so a shared /post/<id> link unfurls as a styled card (the page itself is a client component).
export async function generateMetadata({ params }) {
  const { id } = await params;
  const p = await contentDb.prepare("SELECT text, author_display, visibility, scheduled_at FROM posts WHERE id = ?").get(id).catch(() => null);
  if (!p || p.visibility === "removed" || (p.scheduled_at && p.scheduled_at > new Date().toISOString())) return { title: "LinkedOut", robots: { index: false } };
  const t = String(p.text || "").replace(/\s+/g, " ").trim();
  return cardMeta(`${p.author_display} on LinkedOut`, t.length > 160 ? t.slice(0, 159) + "…" : t, `/post/${id}`);
}
export default function Layout({ children }) { return children; }
