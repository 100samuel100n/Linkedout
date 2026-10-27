// Comprehensive, believable cold-start engagement for the seeded
// (@linkedout.demo) accounts: likes, emoji reactions (with a realistic long
// tail), comments (plus likes/reactions on comments), saves, reposts, poll
// votes, cringe votes. Safe to re-run any time — it only ADDS what is missing,
// never touches a real user's data, and is deterministic (hash-seeded) so the
// shape of the feed is stable between runs.
//
// Likes/reactions/saves are written straight to their tables (no notification
// spam); comments, reposts and votes go through the real service functions so
// counters stay correct.
import crypto from "node:crypto";
import { contentDb } from "../../lib/content/db.js";
import { getOrCreateAlias } from "../../lib/identity/service.js";
import { createComment, setRepost, votePoll, voteCringe } from "../../lib/content/service.js";

const unit = (s) => parseInt(crypto.createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;
const pickBy = (arr, key) => arr[Math.floor(unit(key) * arr.length) % arr.length];
const uuid = () => crypto.randomUUID();

// Reaction palettes per post type, plus a rare long tail so a popular post shows
// the "+N" overflow chip like a real one would.
const PALETTE = {
  rant: ["😩", "💀", "🚩", "🔥", "😤", "🫠"],
  confession: ["🫂", "😩", "💀", "🤝", "😬", "🙈"],
  parody: ["😂", "💀", "🤣", "😭", "👏", "🙃"],
  question: ["🤔", "👀", "🔥", "💯", "🙋"],
  poll: ["👀", "🤔", "😂", "🔥"],
  event: ["🔥", "🎉", "👀", "🙌"],
  default: ["😂", "😩", "💀", "🔥", "🚩"],
};
const TAIL = ["🧠", "🫡", "🥲", "🤯", "🪦", "🍿", "🧯", "📉", "🫶", "🤡", "🥴", "🦦", "☕", "📎", "🧊", "🪑", "🎯", "🛟", "🐢", "🌶️"];

const COMMENTS = {
  rant: ["This is exactly what happened to me last quarter.", "The part about 'alignment meetings' is painfully accurate.", "Sending this to my skip-level, anonymously.", "Not me nodding in agreement at my desk.", "Every word. Every single word.", "And they called it 'a growth opportunity'.", "I needed to read this today, thank you."],
  confession: ["Thank you for saying it out loud. You're not alone.", "I've done the same and never told anyone.", "Honestly brave of you to post this.", "Reading this made me feel a lot less weird about my own situation.", "We've all been there, quietly."],
  parody: ["I physically cannot tell if this is satire anymore.", "This is a real corporate post, isn't it.", "Screenshotting for the group chat.", "'Thrilled to announce' has done irreparable damage to me.", "Ten out of ten on the cringe scale."],
  question: ["In my experience, put it in writing and follow up in 48 hours.", "Depends on the company, but I'd lean toward asking for the number first.", "I'd talk to someone outside your team before deciding.", "Following, I have the same question.", "What worked for me was documenting everything from day one."],
  poll: ["Voted. The results are not surprising.", "Option three, and it's not close.", "Tried to pick two. Had to pick one. Pain."],
  event: ["I'll be there, bringing my own coffee.", "Saving the date, thanks for organizing.", "Is there a recording for those of us in other time zones?"],
  default: ["Well said.", "This deserves more visibility.", "Same here.", "Couldn't have put it better.", "Following this thread."],
};
const REPLIES = ["Agreed.", "This.", "Same experience here.", "Fair point.", "Never thought of it that way.", "Exactly this.", "Heard."];

const CHUNK = 400;
async function insertMany(sql, rows, width) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const ph = part.map((_, r) => `(${Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(",")})`).join(",");
    await contentDb.pool.query(sql.replace("%VALUES%", ph), part.flat());
  }
}

export async function seedEngagement(accounts, log = console.log) {
  // 1) who is who
  const people = [];
  for (const a of accounts) people.push({ id: a.id, pseudonym: a.pseudonym, key: (await getOrCreateAlias(a.id)).anonymousId, hq: a.pseudonym === "linkedout_hq" });
  const voters = people.filter((p) => !p.hq);
  const { rows: posts } = await contentDb.pool.query("SELECT id, type, anonymous_id, created_at, cringe_nominated FROM posts WHERE repost_of IS NULL ORDER BY created_at ASC");
  if (!posts.length) { log("  no posts yet — nothing to engage with"); return; }
  const after = (iso, k, maxHours) => new Date(new Date(iso).getTime() + (0.05 + unit(k) * maxHours) * 3600e3).toISOString();

  // Heavy-tailed popularity: a few posts really take off, most get modest traction.
  const pop = new Map(posts.map((p) => [p.id, Math.min(1, 0.06 + unit("pop:" + p.id) ** 2.4 * 1.1)]));

  // 2) likes
  const likes = [], reacts = [], saves = [];
  for (const p of posts) {
    const pp = pop.get(p.id), pal = PALETTE[p.type] || PALETTE.default;
    for (const v of voters) {
      if (v.key === p.anonymous_id) continue;
      const k = `${p.id}:${v.key}`;
      if (unit("like:" + k) < 0.12 + pp * 0.7) likes.push([p.id, v.key, after(p.created_at, "lt:" + k, 72)]);
      if (unit("react:" + k) < 0.06 + pp * 0.4) {
        const e = unit("tail:" + k) < 0.07 + pp * 0.1 ? pickBy(TAIL, "te:" + k) : pickBy(pal, "pe:" + k);
        reacts.push([uuid(), p.id, v.key, e, after(p.created_at, "rt:" + k, 72)]);
      }
      if (unit("save:" + k) < 0.03 + pp * 0.22) saves.push([uuid(), p.id, v.key, after(p.created_at, "st:" + k, 120)]);
    }
  }
  // One reaction per account per post (the app enforces this): drop extras, and skip posts already reacted to.
  const { rows: haveR } = await contentDb.pool.query("SELECT post_id, anon_key FROM reactions");
  const seenR = new Set(haveR.map((r) => `${r.post_id}:${r.anon_key}`));
  const reactsNew = reacts.filter((r) => { const k = `${r[1]}:${r[2]}`; if (seenR.has(k)) return false; seenR.add(k); return true; });
  await insertMany("INSERT INTO likes (post_id, anon_key, created_at) VALUES %VALUES% ON CONFLICT DO NOTHING", likes, 3);
  await insertMany("INSERT INTO reactions (id, post_id, anon_key, reaction, created_at) VALUES %VALUES% ON CONFLICT DO NOTHING", reactsNew, 5);
  await insertMany("INSERT INTO bookmarks (id, post_id, anon_key, created_at) VALUES %VALUES% ON CONFLICT DO NOTHING", saves, 4);
  log(`  likes +${likes.length} · reactions +${reactsNew.length} · saves +${saves.length}`);

  // 3) comments (through the real service so comment_count stays right)
  const { rows: cc } = await contentDb.pool.query("SELECT post_id, COUNT(*)::int AS n FROM comments GROUP BY post_id");
  const haveC = new Map(cc.map((r) => [r.post_id, r.n]));
  let comments = 0;
  for (const p of posts) {
    const target = Math.round(pop.get(p.id) * 7 * (0.6 + unit("ct:" + p.id)));
    let have = haveC.get(p.id) || 0;
    const pool = COMMENTS[p.type] || COMMENTS.default;
    for (let i = have; i < target; i++) {
      const who = voters[Math.floor(unit(`cw:${p.id}:${i}`) * voters.length)];
      if (who.key === p.anonymous_id && voters.length > 1) continue;
      const text = i > 1 && unit(`reply:${p.id}:${i}`) < 0.35 ? pickBy(REPLIES, `rp:${p.id}:${i}`) : pickBy(pool, `cp:${p.id}:${i}`);
      await createComment({ postId: p.id, anonymousId: who.key, authorDisplay: who.pseudonym, text, createdAt: after(p.created_at, `cd:${p.id}:${i}`, 60) });
      comments++;
    }
  }
  // likes + emoji reactions on comments
  const { rows: allC } = await contentDb.pool.query("SELECT id, anonymous_id, created_at FROM comments");
  const cl = [], cr = [];
  for (const c of allC) {
    for (const v of voters) {
      if (v.key === c.anonymous_id) continue;
      const k = `${c.id}:${v.key}`;
      if (unit("cl:" + k) < 0.1) cl.push([c.id, v.key, after(c.created_at, "clt:" + k, 48)]);
      else if (unit("cr:" + k) < 0.05) cr.push([uuid(), c.id, v.key, pickBy(["😂", "💀", "🔥", "🫡", "😩"], "cre:" + k), after(c.created_at, "crt:" + k, 48)]);
    }
  }
  await insertMany("INSERT INTO comment_likes (comment_id, anon_key, created_at) VALUES %VALUES% ON CONFLICT DO NOTHING", cl, 3);
  await insertMany("INSERT INTO comment_reactions (id, comment_id, anon_key, reaction, created_at) VALUES %VALUES% ON CONFLICT DO NOTHING", cr, 5);
  log(`  comments +${comments} · comment likes +${cl.length} · comment reactions +${cr.length}`);

  // 4) reposts — the most popular posts get a few, one per account at most
  let reposts = 0;
  const top = [...posts].sort((a, b) => pop.get(b.id) - pop.get(a.id)).slice(0, Math.max(3, Math.round(posts.length * 0.15)));
  for (const p of top) {
    const n = 1 + Math.floor(pop.get(p.id) * 3);
    for (let i = 0; i < n; i++) {
      const who = voters[Math.floor(unit(`rw:${p.id}:${i}`) * voters.length)];
      if (who.key === p.anonymous_id) continue;
      const { rows } = await contentDb.pool.query("SELECT 1 FROM reposts WHERE post_id = $1 AND anon_key = $2", [p.id, who.key]);
      if (rows.length) continue;
      const res = await setRepost({ postId: p.id, anonKey: who.key, on: true, quoteText: unit(`rq:${p.id}:${i}`) < 0.3 ? "This is too real." : null, authorDisplay: who.pseudonym, anonymousId: who.key });
      if (!res?.error) reposts++;
    }
  }
  log(`  reposts +${reposts}`);

  // 5) poll + cringe votes, through the real vote functions
  let pv = 0, cv = 0;
  for (const p of posts.filter((x) => x.type === "poll")) {
    const { rows: opts } = await contentDb.pool.query("SELECT option_index FROM poll_options WHERE post_id = $1 ORDER BY option_index", [p.id]);
    if (!opts.length) continue;
    const { rows: voted } = await contentDb.pool.query("SELECT DISTINCT anon_key FROM poll_votes WHERE post_id = $1", [p.id]);
    const done = new Set(voted.map((r) => r.anon_key));
    // Skewed so one option clearly leads, like real polls.
    const lead = Math.floor(unit("lead:" + p.id) * opts.length);
    for (const v of voters) {
      if (done.has(v.key) || unit(`pv:${p.id}:${v.key}`) > 0.55 + pop.get(p.id) * 0.4) continue;
      const choice = unit(`pc:${p.id}:${v.key}`) < 0.45 ? lead : Math.floor(unit(`po:${p.id}:${v.key}`) * opts.length);
      await votePoll(p.id, v.key, opts[choice].option_index); pv++;
    }
  }
  for (const p of posts.filter((x) => x.cringe_nominated)) {
    for (const v of voters) if (unit(`cg:${p.id}:${v.key}`) < 0.25 + pop.get(p.id) * 0.4) { const r = await voteCringe(p.id, v.key); if (r) cv++; }
  }
  log(`  poll votes +${pv} · cringe votes +${cv}`);
}
