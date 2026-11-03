import { NextResponse } from "next/server";
import { getCurrentAccountId } from "@/lib/session";
import { submitVerificationRequest, getVerificationRequestsForAccount, attachVerificationDocument } from "@/lib/identity/service";
import { saveVerificationDocument } from "@/lib/identity/documents";

const VALID_TYPES = new Set(["government_id", "business", "professional"]);

export async function GET() {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });
  return NextResponse.json(await getVerificationRequestsForAccount(accountId));
}

// A REAL manual-review workflow, not an instant fake approval — see
// scripts/review-verification.js. Accepts multipart form data: `type`,
// optional `notes` (supporting text), and a `document` file (a photo of
// a government ID, a business registration PDF, etc). The document is
// never public — see lib/identity/documents.js.
export async function POST(request) {
  const accountId = await getCurrentAccountId();
  if (!accountId) return NextResponse.json({ error: "You need to be logged in." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });

  const type = form.get("type");
  const notes = (form.get("notes") || "").toString().trim();
  const document = form.get("document");
  const hasDocument = document && typeof document !== "string";

  if (!VALID_TYPES.has(type) || (!notes && !hasDocument)) {
    return NextResponse.json({ error: "type is required, plus a document, a note, or both." }, { status: 400 });
  }

  try {
    const requestId = await submitVerificationRequest(accountId, type, notes || "(document only, no notes)");
    if (hasDocument) {
      const documentKey = await saveVerificationDocument(requestId, document);
      await attachVerificationDocument(requestId, documentKey);
    }
    return NextResponse.json({ ok: true, requestId }, { status: 201 });
  } catch (e) {
    if (e.code === "ALREADY_PENDING") return NextResponse.json({ error: e.message }, { status: 409 });
    if (e.code === "INVALID_TYPE" || e.code === "TOO_LARGE") return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
