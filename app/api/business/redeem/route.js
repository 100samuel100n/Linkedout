import { redeemInvite } from "@/lib/stories/business";
import { requireViewer, json, fail } from "@/lib/stories/http";
export async function POST(request) { const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({})); try { return json(await redeemInvite(b.code, v.key)); } catch (e) { return fail(e); } }
