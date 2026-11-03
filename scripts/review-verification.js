#!/usr/bin/env node
// Operator-run review for government ID / business / professional
// verification requests — a REAL manual-review workflow, not an instant
// fake approval. See README.
//
// Usage:
//   node scripts/review-verification.js --list
//   node scripts/review-verification.js --id <requestId> --decision approved --reviewed-by "<operator>" [--note "..."]
import { listPendingVerificationRequests, listRecentlyReviewedVerificationRequests, reviewVerificationRequest } from "../lib/identity/service.js";
import { getVerificationDocumentSignedUrl } from "../lib/identity/documents.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list" || argv[i] === "--history") { out[argv[i].slice(2)] = true; continue; }
    const key = argv[i]?.replace(/^--/, "");
    out[key] = argv[i + 1];
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  const pending = await listPendingVerificationRequests();
  if (pending.length === 0) {
    console.log("No pending verification requests.");
  } else {
    const rows = await Promise.all(pending.map(async (r) => ({
      id: r.id, account_id: r.account_id, type: r.type,
      notes: r.submitted_data.slice(0, 60),
      // A signed URL good for 10 minutes — open it before it expires;
      // re-run --list to mint a fresh one. Never a bare path: this
      // bucket has no public URL for anything in it.
      document: r.document_path ? await getVerificationDocumentSignedUrl(r.document_path) : "(none)",
      requested_at: r.created_at,
    })));
    console.table(rows);
  }
  process.exit(0);
}

if (args.history) {
  const reviewed = await listRecentlyReviewedVerificationRequests();
  if (reviewed.length === 0) {
    console.log("No reviewed requests yet.");
  } else {
    console.table(reviewed.map((r) => ({
      id: r.id, account_id: r.account_id, type: r.type, status: r.status,
      reviewed_by: r.reviewed_by, note: (r.review_note || "").slice(0, 40), reviewed_at: r.reviewed_at,
    })));
  }
  process.exit(0);
}

const { id, decision, note } = args;
const reviewedBy = args["reviewed-by"];

if (!id || !decision || !reviewedBy) {
  console.error('Usage: node scripts/review-verification.js --id <requestId> --decision approved|rejected --reviewed-by "<operator>" [--note "..."]');
  console.error("       node scripts/review-verification.js --list     (pending queue)");
  console.error("       node scripts/review-verification.js --history  (recent decisions, for audit)");
  process.exit(1);
}

try {
  const account = await reviewVerificationRequest(id, decision, reviewedBy, note || "");
  console.log(`Request ${decision}. Account ${account.pseudonym}'s status is now:`, {
    governmentId: account.governmentIdStatus,
    business: account.businessVerifiedStatus,
    professional: account.professionalVerifiedStatus,
  });
} catch (e) {
  console.error("Could not review request:", e.message);
  process.exit(1);
}
