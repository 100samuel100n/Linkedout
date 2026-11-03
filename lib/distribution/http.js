import { NextResponse } from "next/server";
import { clientIp } from "@/lib/client-ip";
export const fail = (e) => {
  if (e?.status && e.status < 500) return NextResponse.json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, { status: e.status });
  console.error("[distribution]", e?.message || e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
};
export const ctx = (request) => ({ ip: clientIp(request), country: (request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || "").toUpperCase().replace("XX", "") || null });
export const NOSTORE = { "Cache-Control": "no-store" };
