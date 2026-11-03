// Believable social graph + plan mix for the seeded (@linkedout.demo)
// accounts. Idempotent and safe to re-run: it only ADDS follows that are
// missing and only touches seeded accounts, never a real user's data.
//
// Why a separate module: the old seed code skipped follows entirely if even
// ONE follow row existed (a single real follow was enough to leave every
// seeded profile at zero) and wrote follows through followHandle(), which
// also fires a notification per follow. This version tops up per account and
// writes rows directly, so it can be re-run any time without spamming anyone.
import crypto from "node:crypto";
import { identityDb } from "../../lib/identity/db.js";
import { getOrCreateAlias } from "../../lib/identity/service.js";

// Deterministic 0..1 from a string, so the graph is stable between runs.
const unit = (s) => parseInt(crypto.createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;

export async function loadSeedAccounts() {
  const { rows } = await identityDb.pool.query("SELECT id, pseudonym FROM accounts WHERE email LIKE '%@linkedout.demo' ORDER BY created_at, id");
  return rows;
}

// ~62% Basic, ~26% Plus, ~12% Pro — like a real consumer product, not a
// showroom. HQ is Pro. Assignment is by a stable hash of the handle.
export function planFor(pseudonym) {
  if (pseudonym === "linkedout_hq") return "pro";
  const u = unit("plan:" + pseudonym);
  return u < 0.12 ? "pro" : u < 0.38 ? "plus" : "basic";
}

export async function seedTiers(accounts, log = console.log) {
  const counts = { basic: 0, plus: 0, pro: 0 };
  for (const a of accounts) {
    const tier = planFor(a.pseudonym);
    counts[tier]++;
    // Written directly (not setPremiumTier) so no fake billing events appear.
    await identityDb.pool.query(
      "UPDATE accounts SET premium_tier = $1, is_premium = $2 WHERE id = $3 AND email LIKE '%@linkedout.demo'",
      [tier, tier === "basic" ? 0 : 1, a.id]
    );
  }
  log(`  plans: ${counts.basic} Basic · ${counts.plus} Plus · ${counts.pro} Pro`);
}

export async function seedFollows(accounts, log = console.log) {
  const hq = accounts.find((a) => a.pseudonym === "linkedout_hq");
  const people = accounts.filter((a) => a.pseudonym !== "linkedout_hq");
  const handle = new Map();
  for (const a of accounts) handle.set(a.id, (await getOrCreateAlias(a.id)).anonymousId);

  // Some people are simply more followed than others (a few "regulars", a long
  // tail), which is what gives follower counts a natural spread.
  const popularity = new Map(people.map((a) => [a.id, 0.25 + unit("pop:" + a.pseudonym) ** 2 * 1.75]));

  const { rows: existing } = await identityDb.pool.query("SELECT follower_account_id AS f, followed_handle AS h FROM follows");
  const have = new Set(existing.map((r) => `${r.f}>${r.h}`));
  const now = Date.now();
  let added = 0;

  async function add(follower, targetHandle, daysAgo) {
    const key = `${follower.id}>${targetHandle}`;
    if (have.has(key)) return;
    have.add(key);
    const when = new Date(now - daysAgo * 864e5 - unit(key) * 864e5).toISOString();
    await identityDb.pool.query(
      "INSERT INTO follows (follower_account_id, followed_handle, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [follower.id, targetHandle, when]
    );
    added++;
  }

  // Everyone follows HQ, and HQ (a brand account) follows no one back.
  if (hq) for (const a of people) await add(a, handle.get(hq.id), 20 + unit("hq:" + a.pseudonym) * 40);

  // Each person follows 40–75% of the others, favouring the popular.
  for (const a of people) {
    const others = people.filter((o) => o.id !== a.id);
    const frac = 0.4 + unit("frac:" + a.pseudonym) * 0.35;
    const want = Math.round(others.length * frac);
    // Weighted pick without replacement (Efraimidis–Spirakis keys).
    const ranked = others
      .map((o) => ({ o, k: Math.pow(unit(`pick:${a.pseudonym}:${o.pseudonym}`), 1 / popularity.get(o.id)) }))
      .sort((x, y) => y.k - x.k)
      .slice(0, want);
    for (const { o } of ranked) await add(a, handle.get(o.id), unit(`age:${a.pseudonym}:${o.pseudonym}`) * 55);
  }

  const { rows: stats } = await identityDb.pool.query(
    `SELECT MIN(c) AS lo, MAX(c) AS hi, ROUND(AVG(c)) AS avg FROM (SELECT COUNT(*) AS c FROM follows GROUP BY followed_handle) t`
  );
  log(`  added ${added} follows; followers per account: min ${stats[0].lo}, avg ${stats[0].avg}, max ${stats[0].hi}`);
}
