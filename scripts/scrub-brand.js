#!/usr/bin/env node
// One-off: rewrite the old seeded wording already stored in the database, so the word
// "LinkedIn" no longer appears in existing posts, comments, polls, announcements, etc.
// Safe to re-run. Run it against the same database your app uses:
//
//   npm run scrub:brand            (reports what it would change)
//   npm run scrub:brand -- --apply (makes the change)
import { contentDb } from "../lib/content/db.js";
import { identityDb } from "../lib/identity/db.js";

const apply = process.argv.includes("--apply");
// Exact old seed lines first (so they read naturally), then a generic fallback.
const PHRASES = [
  ["Read it on LinkedIn befo", "Read it on a career feed befo"],
  ["because LinkedIn told us to be grateful for opportunities that laid us off", "because polished career feeds told us to be grateful for opportunities that laid us off"],
  ["unhinged LinkedIn-style parody post", "unhinged corporate-style parody post"],
  ["This is a real LinkedIn post, isn't it.", "This is a real corporate post, isn't it."],
  ["Posted a LinkedIn story", "Posted a career story"],
];
const TARGETS = [
  [contentDb, "posts", ["title", "text"]], [contentDb, "comments", ["text"]],
  [contentDb, "poll_options", ["label"]], [contentDb, "company_reviews", ["body", "tag_text"]],
  [contentDb, "company_horror_stories", ["body"]], [contentDb, "rooms", ["topic"]],
  [contentDb, "announcements", ["title", "body"]], [identityDb, "accounts", ["bio"]],
];

let total = 0;
for (const [db, table, cols] of TARGETS) {
  for (const col of cols) {
    let n;
    try { n = Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} ILIKE '%linkedin%'`).get())?.n || 0); }
    catch { continue; } // column or table not present in this deployment
    if (!n) continue;
    total += n;
    console.log(`${table}.${col}: ${n} row(s)`);
    if (!apply) continue;
    for (const [from, to] of PHRASES) await db.prepare(`UPDATE ${table} SET ${col} = REPLACE(${col}, ?, ?) WHERE ${col} LIKE ?`).run(from, to, `%${from}%`);
    await db.prepare(`UPDATE ${table} SET ${col} = regexp_replace(${col}, 'linked[ _-]?in', 'corporate feeds', 'gi') WHERE ${col} ILIKE '%linkedin%'`).run();
  }
}
console.log(apply ? `Done. Rewrote ${total} field(s).` : `${total} field(s) mention it. Re-run with --apply to rewrite them.`);
process.exit(0);
