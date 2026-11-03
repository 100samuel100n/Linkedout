import { NextResponse } from "next/server";
import { companyForScim } from "@/lib/security/company-sso";
import { scimList, scimCreate } from "@/lib/security/scim";
const json = (b, s = 200) => NextResponse.json(b, { status: s, headers: { "Content-Type": "application/scim+json" } });
const auth = async (req) => companyForScim((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
export async function GET(req) { const c = await auth(req); if (!c) return json({ detail: "Unauthorized" }, 401); return json(await scimList(c, new URL(req.url).searchParams)); }
export async function POST(req) { const c = await auth(req); if (!c) return json({ detail: "Unauthorized" }, 401); try { return json(await scimCreate(c, await req.json()), 201); } catch (e) { return json({ detail: e.message, status: String(e.status || 400) }, e.status || 400); } }
