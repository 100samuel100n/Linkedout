// Tops up engagement (likes, emoji reactions, comments, saves, reposts, poll
// votes, follows and the plan mix) on an ALREADY-seeded database. Idempotent:
//   node --env-file=.env.production.local scripts/seed-engagement.js
import { identityDb } from "../lib/identity/db.js";
import { contentDb } from "../lib/content/db.js";
import { loadSeedAccounts, seedFollows, seedTiers } from "./lib/social-graph.js";
import { seedEngagement } from "./lib/engagement.js";

await identityDb.ensureReady();
await contentDb.ensureReady();
const accounts = await loadSeedAccounts();
if (!accounts.length) { console.log("No seeded accounts found — run scripts/seed-content.js first."); process.exit(0); }
console.log(`Seeded accounts: ${accounts.length}`);
await seedTiers(accounts);
await seedFollows(accounts);
await seedEngagement(accounts);
console.log("Done.");
process.exit(0);
