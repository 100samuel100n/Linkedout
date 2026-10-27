#!/usr/bin/env node
// Break-glass step 2 of 2: approve a pending request and, in the same
// step, actually resolve the identity. Requires:
//   - the request still exists and is 'pending'
//   - it hasn't expired (24h from filing)
//   - the approver is a DIFFERENT operator than whoever filed it
// Every successful approval writes a permanent row to audit_log. See
// Moderation & Anonymity Architecture, Section 2.4.
//
// Usage:
//   node scripts/break-glass-approve.js --request-id <id> --approved-by "<operator>"
import { approveBreakGlass, getAuditLog } from "../lib/identity/service.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const requestId = args["request-id"];
const approvedBy = args["approved-by"];

if (!requestId || !approvedBy) {
  console.error('Usage: node scripts/break-glass-approve.js --request-id <id> --approved-by "<operator>"');
  process.exit(1);
}

try {
  const { account, request } = await approveBreakGlass(requestId, approvedBy);
  console.log(`Request ${request.status}. Requested by ${request.requested_by}, approved by ${request.approved_by}.\n`);
  if (!account) {
    console.log("No account found for that anonymous id. The audit entry was still recorded.");
  } else {
    console.log("Resolved:", { email: account.email, realName: account.realName });
  }
} catch (e) {
  console.error(`Could not approve request: ${e.message}`, e.code ? `[${e.code}]` : "");
  process.exit(1);
}

console.log("\nRecent audit log:");
console.table((await getAuditLog()).slice(0, 5));
