// Short, shareable story links (see app/s/[code]/route.js). Pure helpers, safe on server and client.
export const shortCode = (id) => String(id || "").replace(/-/g, "").slice(0, 8).toLowerCase();
export const shortUrl = (base, id) => `${String(base).replace(/\/$/, "")}/s/${String(id).slice(0, 8).toLowerCase()}`;
export function shareText(story) {
  const t = story?.title || `${story?.formatLabel || "A story"}${story?.company ? ` at ${story.company}` : ""}`;
  return `${t} · on LinkedOut`;
}
