import { deleteSaved, toggleSavedAlerts } from "@/lib/stories/alerts";
import { requireViewer, json, fail } from "@/lib/stories/http";
export async function DELETE(_r, { params }) { const v = await requireViewer(); if (v.error) return v.error; const { id } = await params; try { return json(await deleteSaved(v.accountId, id)); } catch (e) { return fail(e); } }
export async function PATCH(request, { params }) { const v = await requireViewer(); if (v.error) return v.error; const { id } = await params; const b = await request.json().catch(() => ({})); try { return json(await toggleSavedAlerts(v.accountId, id, !!b.alerts)); } catch (e) { return fail(e); } }
