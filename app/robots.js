// Public pages are crawlable; private app areas are kept out with an X-Robots-Tag header (next.config.mjs),
// which works even if another site links to them. Only /api and /admin are blocked from crawling outright.
export default function robots() {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://linkedoutnetwork.com").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
