#!/usr/bin/env node
// Break-glass step 1 of 2: file a request. This does NOT resolve any
// identity — it only records that someone wants to, with a reason and an
// expiry. A different operator must run break-glass-approve.js before any
// lookup happens. See Moderation & Anonymity Architecture, Section 2.4.
//
// Usage:
//   node scripts/break-glass-request.js --anonymous-id <id> --reason "..." --requested-by "<operator>"
import { requestBreakGlass } from "../lib/identity/service.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const anonymousId = args["anonymous-id"];
const reason = args["reason"];
const requestedBy = args["requested-by"];

if (!anonymousId || !reason || !requestedBy) {
  console.error('Usage: node scripts/break-glass-request.js --anonymous-id <id> --reason "..." --requested-by "<operator>"');
  process.exit(1);
}

try {
  const request = await requestBreakGlass(anonymousId, reason, requestedBy);
  console.log("Request filed. A DIFFERENT operator must approve it:\n");
  console.log(`  npm run break-glass:approve -- --request-id ${request.id} --approved-by "<a different operator>"\n`);
  console.table([{
    id: request.id,
    anonymous_id: request.anonymous_id,
    requested_by: request.requested_by,
    expires_at: request.expires_at,
  }]);
} catch (e) {
  console.error("Could not file request:", e.message);
  process.exit(1);
}
