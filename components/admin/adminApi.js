"use client";
// Thin client for /api/admin/* (same-origin cookie auth on web).
async function call(path, opts = {}) {
  const res = await fetch(`/api/admin/${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}
export const adminApi = {
  me: () => call("me"),
  get: (p) => call(p),
  post: (p, body) => call(p, { method: "POST", body: JSON.stringify(body || {}) }),
};
