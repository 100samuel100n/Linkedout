#!/usr/bin/env node
// Operator review for company pages: documents, verification decisions,
// suspensions and disputes. Same pattern as scripts/review-verification.js —
// documents are only ever opened through short-lived signed URLs.
//
//   node scripts/review-company.js --list                       # pages awaiting document review
//   node scripts/review-company.js --disputes                   # open reports
//   node scripts/review-company.js --id <companyId> --decision verified|rejected [--note "..."]
//   node scripts/review-company.js --id <companyId> --suspend "reason"   |  --unsuspend
//   node scripts/review-company.js --dispute <disputeId> --resolve "what was decided" [--remove-content]
import crypto from "node:crypto";
import { contentDb } from "../lib/content/db.js";
import { getPrivateSignedUrl } from "../lib/storage.js";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, "");
  if (["list", "disputes", "unsuspend", "remove-content"].includes(k)) args[k] = true; else args[k] = argv[++i];
}
const now = () => new Date().toISOString();
const audit = (id, action, detail) => contentDb.prepare("INSERT INTO company_audit (id, company_id, actor, action, detail, created_at) VALUES (?, ?, 'operator', ?, ?, ?)").run(crypto.randomUUID(), id, action, JSON.stringify(detail || {}), now());

if (args.list) {
  const rows = await contentDb.prepare("SELECT * FROM companies WHERE verification = 'submitted' AND status = 'active' ORDER BY updated_at").all();
  if (!rows.length) console.log("Nothing awaiting review.");
  for (const c of rows) {
    console.log(`\n${c.name}  (${c.id})\n  legal: ${c.legal_name} · ${c.registration_country} · reg# ${c.registration_number}\n  site: ${c.website}  domain verified: ${!!c.domain_verified}  role: ${c.relationship}`);
    const docs = await contentDb.prepare("SELECT * FROM company_documents WHERE company_id = ?").all(c.id);
    for (const d of docs) console.log(`  [${d.doc_type}] ${d.filename}\n    ${await getPrivateSignedUrl(d.file_key)}`);
  }
  process.exit(0);
}
if (args.disputes) {
  const rows = await contentDb.prepare("SELECT d.*, c.name FROM company_disputes d JOIN companies c ON c.id = d.company_id WHERE d.status = 'open' ORDER BY d.created_at").all();
  if (!rows.length) console.log("No open reports.");
  console.table(rows.map((d) => ({ id: d.id, company: d.name, target: `${d.target_type}${d.target_id ? ":" + d.target_id.slice(0, 8) : ""}`, reason: d.reason, details: d.details.slice(0, 70), filed: d.created_at })));
  process.exit(0);
}
if (args.id && args.decision) {
  if (!["verified", "rejected"].includes(args.decision)) { console.error("decision must be verified or rejected"); process.exit(1); }
  await contentDb.prepare("UPDATE companies SET verification = ?, verification_note = ?, verified_at = ?, updated_at = ? WHERE id = ?")
    .run(args.decision, args.note || null, args.decision === "verified" ? now() : null, now(), args.id);
  if (args.decision === "rejected") {
    // Rejected documents are erased 30 days later by the purge job; mark now.
    await contentDb.prepare("UPDATE companies SET deleted_at = deleted_at WHERE id = ?").run(args.id);
  }
  await audit(args.id, `verification_${args.decision}`, { note: args.note });
  console.log(`Company ${args.id} -> ${args.decision}`);
  process.exit(0);
}
if (args.id && (args.suspend || args.unsuspend)) {
  await contentDb.prepare("UPDATE companies SET status = ?, verification_note = ?, updated_at = ? WHERE id = ?")
    .run(args.unsuspend ? "active" : "suspended", args.suspend || null, now(), args.id);
  await audit(args.id, args.unsuspend ? "unsuspended" : "suspended", { reason: args.suspend });
  console.log("Done.");
  process.exit(0);
}
if (args.dispute && args.resolve) {
  const d = await contentDb.prepare("SELECT * FROM company_disputes WHERE id = ?").get(args.dispute);
  if (!d) { console.error("No such dispute."); process.exit(1); }
  if (args["remove-content"] && d.target_id) {
    const table = d.target_type === "review" ? "company_reviews" : d.target_type === "story" ? "company_horror_stories" : null;
    if (table) await contentDb.prepare(`DELETE FROM ${table} WHERE id = ?`).run(d.target_id);
  }
  await contentDb.prepare("UPDATE company_disputes SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?").run(args.resolve, now(), args.dispute);
  await audit(d.company_id, "dispute_resolved", { resolution: args.resolve, contentRemoved: !!args["remove-content"] });
  console.log("Dispute resolved.");
  process.exit(0);
}
console.log("See the usage comment at the top of this file.");
process.exit(0);
