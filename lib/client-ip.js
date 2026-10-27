// Best-effort client IP behind a proxy. Fly.io sets Fly-Client-IP (not
// spoofable by the client); otherwise fall back to the left-most
// X-Forwarded-For entry.
export function clientIp(request) {
  const h = request.headers;
  const fly = h.get("fly-client-ip");
  if (fly) return fly.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return h.get("x-real-ip")?.trim() || null;
}
