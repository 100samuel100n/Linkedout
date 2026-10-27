// Repairs / tops up the social graph and plan mix on an ALREADY-seeded
// database (no content is created). Safe to run any time:
//   node --env-file=.env.production.local scripts/seed-social.js
import { identityDb } from "../lib/identity/db.js";
import { loadSeedAccounts, seedFollows, seedTiers } from "./lib/social-graph.js";

await identityDb.ensureReady();
const accounts = await loadSeedAccounts();
if (!accounts.length) { console.log("No seeded accounts found — run scripts/seed-content.js first."); process.exit(0); }
console.log(`Seeded accounts: ${accounts.length}`);
await seedTiers(accounts);
await seedFollows(accounts);
console.log("Tip: run scripts/seed-engagement.js to top up likes, reactions, comments and saves.");
console.log("Done.");
process.exit(0);
