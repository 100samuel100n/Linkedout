import { parseKey, renderPng } from "@/lib/avatar-art";

// Serves a generated avatar. The picture is a pure function of the key in
// the URL, and the key says nothing about which account owns it, so this
// can be cached forever by browsers and any CDN in front of the app.
export async function GET(request, { params }) {
  const { key: raw } = await params;
  const key = String(raw || "").replace(/\.png$/i, "");
  if (!parseKey(key)) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const size = Math.max(32, Math.min(512, Number(url.searchParams.get("s")) || 256));
  const png = renderPng(key, size, size);
  return new Response(png, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
