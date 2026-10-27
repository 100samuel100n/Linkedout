import { getCircle, joinCircle, leaveCircle } from "@/lib/stories/circles";
import { viewer, requireViewer, json, fail } from "@/lib/stories/http";

export async function GET(_req, { params }) { const { slug } = await params; const v = await viewer(); try { const c = await getCircle(slug, v.key); return c ? json(c) : json({ error: "Circle not found." }, 404); } catch (e) { return fail(e); } }
export async function POST(_req, { params }) { const v = await requireViewer(); if (v.error) return v.error; const { slug } = await params; try { return json(await joinCircle(slug, v.key)); } catch (e) { return fail(e); } }
export async function DELETE(_req, { params }) { const v = await requireViewer(); if (v.error) return v.error; const { slug } = await params; try { return json(await leaveCircle(slug, v.key)); } catch (e) { return fail(e); } }
