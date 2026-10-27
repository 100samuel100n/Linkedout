import { listSaved, saveSearch } from "@/lib/stories/alerts";
import { requireViewer, json, fail } from "@/lib/stories/http";
export async function GET() { const v = await requireViewer(); if (v.error) return v.error; try { return json({ searches: await listSaved(v.accountId), limit: v.perks.savedSearches }); } catch (e) { return fail(e); } }
export async function POST(request) { const v = await requireViewer(); if (v.error) return v.error; const b = await request.json().catch(() => ({})); try { return json(await saveSearch(v.accountId, b, v.perks.savedSearches), 201); } catch (e) { return fail(e); } }
