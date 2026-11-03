import { NextResponse } from "next/server";
import { companyForScim } from "@/lib/security/company-sso";
import { scimGet, scimPatch, scimDelete } from "@/lib/security/scim";
const json = (b, s = 200) => NextResponse.json(b, { status: s, headers: { "Content-Type": "application/scim+json" } });
const auth = async (req) => companyForScim((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
const wrap = (fn) => async (req, { params }) => { const c = await auth(req); if (!c) return json({ detail: "Unauthorized" }, 401); try { const { uid } = await params; const r = await fn(c, uid, req.method === "PATCH" ? await req.json() : null); return r === null ? new NextResponse(null, { status: 204 }) : json(r); } catch (e) { return json({ detail: e.message, status: String(e.status || 400) }, e.status || 400); } };
export const GET = wrap((c, u) => scimGet(c, u)); export const PATCH = wrap((c, u, b) => scimPatch(c, u, b)); export const PUT = wrap((c, u, b) => scimPatch(c, u, b)); export const DELETE = wrap(async (c, u) => { await scimDelete(c, u); return null; });
