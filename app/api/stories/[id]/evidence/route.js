import crypto from "node:crypto";
import { addEvidence } from "@/lib/stories/service";
import { EVIDENCE_KINDS } from "@/lib/stories/constants";
import { requireViewer, limited, json, fail } from "@/lib/stories/http";
import { uploadPrivateObject } from "@/lib/storage";

// Receipts. Files go to PRIVATE storage and are never served publicly; readers
// only see "Evidence attached" plus the kind and label. The label is redacted
// server-side. A story is labelled "Evidence attached" — never "verified".
const OK = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);
const MAX = 8 * 1024 * 1024;

export async function POST(request, { params }) {
  const v = await requireViewer({ restriction: "posting" }); if (v.error) return v.error;
  const blocked = await limited(v.accountId, "story_evidence"); if (blocked) return blocked;
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: "Invalid upload." }, 400);
  const kind = EVIDENCE_KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "other";
  const label = String(form.get("label") || "");
  const file = form.get("file");
  try {
    if (!file || typeof file === "string") return json(await addEvidence(id, v.key, { kind, label }), 201);
    if (!OK.has(file.type)) return json({ error: "Attach a PNG, JPG, WebP, PDF or text file." }, 400);
    if (file.size > MAX) return json({ error: "Files can be up to 8 MB." }, 400);
    const key = `story-evidence/${id}/${crypto.randomUUID()}`;
    await uploadPrivateObject(key, Buffer.from(await file.arrayBuffer()), file.type);
    return json(await addEvidence(id, v.key, { kind, label, fileKey: key, contentType: file.type, sizeBytes: file.size }), 201);
  } catch (e) { return fail(e); }
}
