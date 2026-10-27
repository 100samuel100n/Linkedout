// GIF search for replies. Tenor's API was shut down on 2026-06-30, so this
// now uses KLIPY (free, built by the original Tenor team) as the primary
// provider, with GIPHY as an automatic fallback if a GIPHY key is set too.
//
//   KLIPY_API_KEY   from https://partner.klipy.com  -> API Keys -> Create Key
//   GIPHY_API_KEY   optional, from https://developers.giphy.com
//
// Both providers are normalised to the same shape the pickers already use:
//   { id, title, url, previewUrl, width, height }
// Nothing here throws on a provider hiccup; the route reports it and the
// picker shows a retry state.
const KLIPY_BASE = "https://api.klipy.com/api/v1";
const GIPHY_BASE = "https://api.giphy.com/v1/gifs";

export function isGifSearchConfigured() {
  return Boolean(process.env.KLIPY_API_KEY || process.env.GIPHY_API_KEY);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`GIF provider returned HTTP ${res.status}`);
  return res.json();
}

// ---- KLIPY ----
// Response items look like { id, slug, title, file: { hd|md|sm|xs: { gif|webp|mp4|jpg: { url, width, height } } } }
// wrapped as { data: { data: [...] } } (older shape: { data: [...] }).
function fromKlipy(json) {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.data) ? json.data.data : [];
  return list.map((it) => {
    const f = it.file || {};
    const full = f.md?.gif || f.hd?.gif || f.sm?.gif || f.gif;
    const preview = f.sm?.gif || f.xs?.gif || f.sm?.webp || f.xs?.jpg || full;
    if (!full?.url) return null;
    return {
      id: String(it.id ?? it.slug),
      title: it.title || "",
      url: full.url,
      previewUrl: preview?.url || full.url,
      width: preview?.width || full.width || 200,
      height: preview?.height || full.height || 200,
    };
  }).filter(Boolean);
}

async function klipy(kind, { q, limit, customerId }) {
  const key = encodeURIComponent(process.env.KLIPY_API_KEY);
  const params = new URLSearchParams({ per_page: String(limit), page: "1" });
  if (customerId) params.set("customer_id", customerId);
  if (q) params.set("q", q);
  const path = q ? "search" : "trending";
  return fromKlipy(await getJson(`${KLIPY_BASE}/${key}/${kind}/${path}?${params}`));
}

// ---- GIPHY ----
function fromGiphy(json) {
  return (json?.data || []).map((g) => {
    const full = g.images?.downsized_medium || g.images?.original;
    const preview = g.images?.fixed_width_small || g.images?.fixed_width || full;
    if (!full?.url) return null;
    return {
      id: String(g.id),
      title: g.title || "",
      url: full.url,
      previewUrl: preview?.url || full.url,
      width: Number(preview?.width) || 200,
      height: Number(preview?.height) || 200,
    };
  }).filter(Boolean);
}

async function giphy({ q, limit }) {
  const params = new URLSearchParams({ api_key: process.env.GIPHY_API_KEY, limit: String(limit), rating: "pg-13" });
  if (q) params.set("q", q);
  return fromGiphy(await getJson(`${GIPHY_BASE}/${q ? "search" : "trending"}?${params}`));
}

async function run(opts) {
  let firstError = null;
  if (process.env.KLIPY_API_KEY) {
    try { return await klipy("gifs", opts); } catch (e) { firstError = e; }
  }
  if (process.env.GIPHY_API_KEY) {
    try { return await giphy(opts); } catch (e) { firstError = firstError || e; }
  }
  throw firstError || new Error("No GIF provider configured.");
}

export async function searchGifs(query, limit = 24, customerId = null) {
  return run({ q: query, limit, customerId });
}

export async function trendingGifs(limit = 24, customerId = null) {
  return run({ q: null, limit, customerId });
}
