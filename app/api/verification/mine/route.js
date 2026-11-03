import { myVerifications, endVerification } from "@/lib/stories/verify";
import { requireViewer, json, fail } from "@/lib/stories/http";
export async function GET() { const v = await requireViewer(); if (v.error) return v.error; try { return json({ verifications: await myVerifications(v.accountId) }); } catch (e) { return fail(e); } }
// "I left this company": switches the badge on your stories from current to former.
export async function POST(request) { const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({})); try { return json(await endVerification(v.accountId, b.id, b.kind)); } catch (e) { return fail(e); } }
