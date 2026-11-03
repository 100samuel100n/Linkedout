import { contentDb } from "@/lib/content/db";
import { GLOSSARY } from "@/lib/stories/glossary";
import { phraseSlug } from "@/lib/stories/seo";
import { STATIC_PAGES, DYNAMIC, NEVER_INDEX_PREFIXES } from "@/lib/seo-config";

// Served at /sitemap.xml. EDIT THE RULES IN lib/seo-config.js (not here).
// Only pages worth landing on are listed: published stories that aren't opted out (high-risk stories are
// always opted out), companies with at least one story, public circles, and the decoder pages.
export const revalidate = 3600;
export default async function sitemap() {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").replace(/\/$/, "");
  const now = new Date();
  const out = STATIC_PAGES.filter((p) => !NEVER_INDEX_PREFIXES.some((x) => p.path.startsWith(x))).map((p) => ({ url: `${base}${p.path}`, lastModified: now, changeFrequency: p.changeFrequency, priority: p.priority }));
  try {
    const s = DYNAMIC.stories;
    const stories = await contentDb.prepare(`SELECT id, updated_at FROM stories WHERE status='published' AND noindex = 0 AND char_length(body) >= ? ORDER BY created_at DESC LIMIT ?`).all(s.minBodyChars, s.limit);
    for (const x of stories) out.push({ url: `${base}/stories/${x.id}`, lastModified: x.updated_at, changeFrequency: s.changeFrequency, priority: s.priority });
    const c = DYNAMIC.companies;
    const cos = await contentDb.prepare("SELECT c.id, c.updated_at FROM companies c WHERE c.status='active' AND EXISTS (SELECT 1 FROM stories s WHERE s.status='published' AND (s.company_id = c.id OR s.company_key = c.name_norm)) LIMIT ?").all(c.limit);
    for (const x of cos) out.push({ url: `${base}/companies/${x.id}`, lastModified: x.updated_at || now, changeFrequency: c.changeFrequency, priority: c.priority });
    const k = DYNAMIC.circles;
    const circles = await contentDb.prepare("SELECT slug FROM circles WHERE status='active' AND visibility='public' LIMIT ?").all(k.limit);
    for (const x of circles) out.push({ url: `${base}/circles/${x.slug}`, lastModified: now, changeFrequency: k.changeFrequency, priority: k.priority });
  } catch { /* database not reachable at build time: static entries still ship */ }
  for (const kind of Object.keys(GLOSSARY)) for (const [phrase] of GLOSSARY[kind]) out.push({ url: `${base}/decoder/${phraseSlug(kind, phrase)}`, lastModified: now, changeFrequency: DYNAMIC.decoder.changeFrequency, priority: DYNAMIC.decoder.priority });
  return out;
}
