import { identityRisk, redactText, namedPeople, swapNames } from "@/lib/stories/redact";
import { requireViewer, json } from "@/lib/stories/http";

// Pre-publish checks. The redaction preview is free for everyone (it protects people);
// identity-risk analysis and anonymous-mode recommendations are OUT+.
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  const b = await request.json().catch(() => ({}));
  const names = namedPeople(`${b.body || ""} ${b.told || ""} ${b.actual || ""}`, { companyName: b.company });
  const out = { redactions: redactText(`${b.body || ""}`).counts, namedPeople: names, swapped: names.length && b.swap ? swapNames(b.body || "", names) : undefined };
  if (v.perks.identityRisk) out.identityRisk = identityRisk(b);
  else out.identityRiskLocked = true;
  return json(out);
}
