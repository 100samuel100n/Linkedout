// Content Service. Route handlers call these functions instead of touching
// lib/content/db.js directly. Nothing here ever accepts or stores an
// account id, email, or real name — only anonymous_id (opaque, shown to
// nobody, from the identity service), anon_key (opaque, used only for
// server-side per-account dedup, never returned to any client), and
// author_display (plain text chosen at post time).
//
// Every exported function here is `async` (and every internal call
// between them is `await`ed) because the underlying store is now
// Postgres (lib/content/db.js), queried over the network — unlike the
// old node:sqlite version, a query can't complete synchronously. Route
// handlers (app/api/**/route.js) already `await` these calls.
import crypto from "node:crypto";
import { contentDb, rowToPost, rowToComment, ROAST_LINES_SEED } from "./db.js";
import { getAliasHandle, getAliasHandles, resolveAliasAccountId, createNotification } from "../identity/service.js";

export const LIKE_EMOJI = "❤️";

// A reaction is a single emoji (skin tones, flags and ZWJ sequences count as
// one). Validated on the server so nothing but a real emoji is ever stored.
const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
export function isValidReaction(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 24) return false;
  if (segmenter && [...segmenter.segment(value)].length !== 1) return false;
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|^[#*0-9]\uFE0F?\u20E3$/u.test(value);
}

// { total, top: [[emoji, count], ...up to 4] } for a set of ids from a
// reactions table ("reactions" for posts, "comment_reactions" for comments).
async function reactionSummaries(table, keyCol, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const ph = ids.map(() => "?").join(",");
  const rows = await contentDb.prepare(
    `SELECT ${keyCol} AS id, reaction, COUNT(*) AS n FROM ${table} WHERE ${keyCol} IN (${ph}) GROUP BY ${keyCol}, reaction`
  ).all(...ids);
  for (const r of rows) {
    const e = (out[r.id] ||= { total: 0, all: [] });
    e.total += Number(r.n);
    e.all.push([r.reaction, Number(r.n)]);
  }
  for (const id of Object.keys(out)) {
    const sorted = out[id].all.sort((a, b) => b[1] - a[1]);
    out[id] = { total: out[id].total, kinds: sorted.length, top: sorted.slice(0, 4) };
  }
  return out;
}

// ---------------- Posts ----------------

// Batched version of attachReactionAndPoll, for a whole page of posts at
// once — a handful of queries total instead of 2-6 PER post. This is
// what getPosts() (the main feed) uses; a 20-post feed for a logged-in
// viewer used to mean 80-120+ sequential database round trips (repost
// count, author lookup, reaction, bookmark, poll data — each its own
// query, per post), competing for a connection pool of 10. That was the
// single biggest contributor to a slow-feeling feed load. This does the
// same work in 6 queries total, regardless of how many posts are on the
// page.
async function attachBatchExtras(rows, viewerAnonKey) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const idPlaceholders = ids.map(() => "?").join(",");

  const repostRows = await contentDb.prepare(
    `SELECT repost_of, COUNT(*) AS n FROM posts WHERE repost_of IN (${idPlaceholders}) GROUP BY repost_of`
  ).all(...ids);
  const repostCountById = Object.fromEntries(repostRows.map((r) => [r.repost_of, Number(r.n)]));

  const anonIds = [...new Set(rows.map((r) => r.anonymous_id).filter(Boolean))];
  const aliasByAnonId = await getAliasHandles(anonIds);

  let reactionByPostId = {};
  let bookmarkedSet = new Set();
  let repostedSet = new Set();
  if (viewerAnonKey) {
    const myRepostRows = await contentDb.prepare(
      `SELECT post_id FROM reposts WHERE post_id IN (${idPlaceholders}) AND anon_key = ?`
    ).all(...ids, viewerAnonKey);
    repostedSet = new Set(myRepostRows.map((r) => r.post_id));

    const reactionRows = await contentDb.prepare(
      `SELECT post_id, reaction FROM reactions WHERE post_id IN (${idPlaceholders}) AND anon_key = ?`
    ).all(...ids, viewerAnonKey);
    reactionByPostId = Object.fromEntries(reactionRows.map((r) => [r.post_id, r.reaction]));

    const bookmarkRows = await contentDb.prepare(
      `SELECT post_id FROM bookmarks WHERE post_id IN (${idPlaceholders}) AND anon_key = ?`
    ).all(...ids, viewerAnonKey);
    bookmarkedSet = new Set(bookmarkRows.map((r) => r.post_id));
  }

  const pollIds = rows.filter((r) => r.type === "poll").map((r) => r.id);
  const optionsByPostId = {};
  const myVotesByPostId = {};
  if (pollIds.length > 0) {
    const pollPlaceholders = pollIds.map(() => "?").join(",");
    const optionRows = await contentDb.prepare(
      `SELECT post_id, option_index, label, votes FROM poll_options WHERE post_id IN (${pollPlaceholders}) ORDER BY post_id, option_index`
    ).all(...pollIds);
    for (const o of optionRows) (optionsByPostId[o.post_id] ||= []).push(o);

    if (viewerAnonKey) {
      const voteRows = await contentDb.prepare(
        `SELECT post_id, option_index FROM poll_votes WHERE post_id IN (${pollPlaceholders}) AND anon_key = ?`
      ).all(...pollIds, viewerAnonKey);
      for (const v of voteRows) (myVotesByPostId[v.post_id] ||= []).push(v.option_index);
    }
  }

  // repost_of is only ever set here when this batch fn is reused for a
  // list that includes reposts (e.g. getPostsByOwnership) — getPosts()
  // itself only ever fetches repost_of IS NULL rows, so this branch is
  // inert for the main feed. Fetched as its own small batch rather than
  // recursing into attachBatchExtras again, to keep this a fixed number
  // of queries regardless of how many reposts are on the page.
  const repostOfIds = [...new Set(rows.map((r) => r.repost_of).filter(Boolean))];
  let originalById = {};
  if (repostOfIds.length > 0) {
    const repostOfPlaceholders = repostOfIds.map(() => "?").join(",");
    const originalRows = await contentDb.prepare(`SELECT * FROM posts WHERE id IN (${repostOfPlaceholders})`).all(...repostOfIds);
    originalById = Object.fromEntries(originalRows.map((r) => [r.id, r]));
  }
  // Hydrate each original FULLY (author avatar/handle/tier, reactions, likes, bookmarks, poll) so a repost
  // renders exactly like the original does on the feed, likes and bookmarks lists. Originals are never
  // reposts themselves (setRepost refuses IS_REPOST), so this recursion is exactly one level deep.
  const originalExtraById = {};
  {
    const flat = Object.values(originalById).filter((r) => !r.repost_of && r.visibility !== "removed");
    if (flat.length > 0) {
      const ex = await attachBatchExtras(flat, viewerAnonKey);
      flat.forEach((r, i) => { originalExtraById[r.id] = ex[i]; });
    }
  }
  // For repost rows in the list: the ORIGINAL's repost count, and whether the
  // viewer has reposted it — that's what the repost button on such a card acts on.
  let originalRepostCount = {};
  let originalMine = new Set();
  if (repostOfIds.length > 0) {
    const ph = repostOfIds.map(() => "?").join(",");
    const cnt = await contentDb.prepare(`SELECT post_id, COUNT(*) AS n FROM reposts WHERE post_id IN (${ph}) GROUP BY post_id`).all(...repostOfIds);
    originalRepostCount = Object.fromEntries(cnt.map((r) => [r.post_id, Number(r.n)]));
    if (viewerAnonKey) {
      const mine = await contentDb.prepare(`SELECT post_id FROM reposts WHERE post_id IN (${ph}) AND anon_key = ?`).all(...repostOfIds, viewerAnonKey);
      originalMine = new Set(mine.map((r) => r.post_id));
    }
  }

  const reactionSummary = await reactionSummaries("reactions", "post_id", ids);
  const likeRows = await contentDb.prepare(`SELECT post_id, COUNT(*) AS n FROM likes WHERE post_id IN (${idPlaceholders}) GROUP BY post_id`).all(...ids);
  const likeCountById = Object.fromEntries(likeRows.map((r) => [r.post_id, Number(r.n)]));
  let myLikeSet = new Set();
  if (viewerAnonKey) {
    const ml = await contentDb.prepare(`SELECT post_id FROM likes WHERE post_id IN (${idPlaceholders}) AND anon_key = ?`).all(...ids, viewerAnonKey);
    myLikeSet = new Set(ml.map((r) => r.post_id));
  }

  return rows.map((row) => {
    const extra = {};
    extra.reactions = reactionSummary[row.id] || { total: 0, top: [] };
    extra.repostCount = repostCountById[row.id] || 0;
    extra.likeCount = likeCountById[row.id] || 0;
    extra.myLike = myLikeSet.has(row.id);
    const alias = aliasByAnonId.get(row.anonymous_id);
    extra.authorHandle = alias ? alias.anonymousId : null;
    extra.authorAvatarUrl = alias ? alias.avatarUrl : null;
    extra.authorTier = alias ? alias.tier : "basic";
    if (viewerAnonKey) {
      extra.myReaction = reactionByPostId[row.id] || null;
      extra.bookmarked = bookmarkedSet.has(row.id);
      extra.myRepost = repostedSet.has(row.id);
    }
    if (row.type === "poll") {
      const options = optionsByPostId[row.id] || [];
      const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
      extra.multiSelect = !!row.multi_select;
      extra.pollOptions = options.map((o) => ({
        index: o.option_index,
        label: o.label,
        votes: o.votes,
        pct: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
      }));
      extra.myPollVotes = viewerAnonKey ? (myVotesByPostId[row.id] || []) : [];
    }
    if (row.repost_of && originalById[row.repost_of] && originalExtraById[row.repost_of]) {
      extra.repostOfPost = rowToPost(originalById[row.repost_of], {
        ...originalExtraById[row.repost_of],
        repostCount: originalRepostCount[row.repost_of] || 0,
        myRepost: originalMine.has(row.repost_of),
      });
    } else if (row.repost_of) {
      extra.repostUnavailable = true; // original was removed or deleted
    }
    return extra;
  });
}

async function attachReactionAndPoll(row, viewerAnonKey) {
  const [extra] = await attachBatchExtras([row], viewerAnonKey);
  return extra;
}

// includeScheduled + ownerAnonymousIds: used by "my posts" so an account
// can see its own not-yet-published scheduled posts; the main feed never
// gets that flag, so scheduled posts stay invisible to everyone else
// until their time comes — a plain read-time filter, no background job.
export async function getPosts({ viewerAnonKey = null, includeScheduledForAnonymousIds = null, limit = 40, before = null } = {}) {
  const nowIso = new Date().toISOString();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 40, 100));
  // Without a LIMIT this used to load EVERY post in the database on every
  // feed view — a slow page (and a heavy query) once
  // real content piles up. `before` is a created_at cursor for "load
  // older" pagination (see app/page.js).
  const beforeClause = before ? "AND created_at < ?" : "";
  let rows;
  if (includeScheduledForAnonymousIds && includeScheduledForAnonymousIds.length > 0) {
    const placeholders = includeScheduledForAnonymousIds.map(() => "?").join(",");
    rows = await contentDb.prepare(
      `SELECT * FROM posts
       WHERE repost_of IS NULL AND visibility <> 'removed' AND (scheduled_at IS NULL OR scheduled_at <= ? OR anonymous_id IN (${placeholders})) ${beforeClause}
       ORDER BY created_at DESC LIMIT ?`
    ).all(nowIso, ...includeScheduledForAnonymousIds, ...(before ? [before] : []), cappedLimit);
  } else {
    rows = await contentDb.prepare(
      `SELECT * FROM posts WHERE repost_of IS NULL AND visibility <> 'removed' AND (scheduled_at IS NULL OR scheduled_at <= ?) ${beforeClause} ORDER BY created_at DESC LIMIT ?`
    ).all(nowIso, ...(before ? [before] : []), cappedLimit);
  }
  const extras = await attachBatchExtras(rows, viewerAnonKey);
  return rows.map((row, i) => rowToPost(row, extras[i]));
}

// Lightweight check for "are there posts newer than the ones I'm already
// showing" — powers the X-style "N new posts" banner (see
// app/page.js) without re-fetching or re-rendering the whole feed on
// every poll. Deliberately just a count, not the posts themselves — the
// banner's click handler calls getPosts() again (page is usually small
// enough that a full refetch on actual click is simpler and fine; this
// endpoint just answers "is it worth showing the banner at all").
export async function countNewerPosts(sinceIso) {
  return (await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE repost_of IS NULL AND created_at > ? AND (scheduled_at IS NULL OR scheduled_at <= ?)"
  ).get(sinceIso, new Date().toISOString())).n;
}

export async function getPostById(id, viewerAnonKey = null) {
  const row = await contentDb.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  if (!row || row.visibility === "removed") return null;
  return rowToPost(row, await attachReactionAndPoll(row, viewerAnonKey));
}

export async function createPost({
  type, mood, text, tags, authorDisplay, anonymousId,
  title, category, visibility, scheduledAt, mediaType, mediaPath,
  pollOptions, multiSelect, eventAt, eventLocation, repostOf, quoteText, cringeNominated,
  // Optional backdate hook — every real API route omits this and gets
  // "now" like always. Only the cold-start seed script passes it, so a
  // batch of seeded posts can carry a natural, staggered history instead
  // of every single one reading "moments ago" the instant the site opens.
  createdAt,
}) {
  const id = crypto.randomUUID();
  const now = createdAt || new Date().toISOString();
  await contentDb.prepare(
    `INSERT INTO posts (
       id, type, mood, title, category, tags, visibility, scheduled_at, pinned,
       media_type, media_path, event_at, event_location, repost_of, quote_text,
       cringe_nominated, cringe_votes, comment_count,
       author_display, anonymous_id, time_label, created_at, text, cry, laugh, skull, flag
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, '', ?, ?, 0, 0, 0, 0)`
  ).run(
    id, type, mood, title || null, category || null, JSON.stringify(tags || []),
    visibility || "public", scheduledAt || null,
    mediaType || null, mediaPath || null, eventAt || null, eventLocation || null,
    repostOf || null, quoteText || null, cringeNominated ? 1 : 0,
    authorDisplay, anonymousId, now, text
  );

  if (type === "poll" && Array.isArray(pollOptions) && pollOptions.length >= 2) {
    if (multiSelect) await contentDb.prepare("UPDATE posts SET multi_select = 1 WHERE id = ?").run(id);
    const insertOption = contentDb.prepare(
      "INSERT INTO poll_options (id, post_id, option_index, label, votes) VALUES (?, ?, ?, ?, 0)"
    );
    for (let i = 0; i < pollOptions.length; i++) {
      await insertOption.run(crypto.randomUUID(), id, i, pollOptions[i]);
    }
  }

  return getPostById(id);
}

export async function setPinned(postId, ownerAnonymousIds, pinned) {
  const post = await contentDb.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || !ownerAnonymousIds.includes(post.anonymous_id)) {
    const err = new Error("You can only pin your own posts.");
    err.code = "NOT_OWNER";
    throw err;
  }
  if (pinned) {
    const placeholders = ownerAnonymousIds.map(() => "?").join(",");
    await contentDb.prepare(`UPDATE posts SET pinned = 0 WHERE anonymous_id IN (${placeholders})`).run(...ownerAnonymousIds);
  }
  await contentDb.prepare("UPDATE posts SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, postId);
  return getPostById(postId);
}

// Real per-account dedup: an anon_key can hold at most one active reaction
// per post at a time (radio-button behavior, server-enforced this time —
// the earlier version of this app only enforced that client-side, which
// meant repeated API calls could inflate counts).
// One active reaction per account per post, enforced by a unique index.
// Tapping the same emoji again removes it; tapping a different one swaps it.
async function postReactionSummary(postId) {
  return (await reactionSummaries("reactions", "post_id", [postId]))[postId] || { total: 0, top: [] };
}

// Likes: their own table and counts, independent of emoji reactions. Idempotent
// when `on` is given (so a fast double-tap or a retry can't flip it back).
export async function setLike(postId, anonKey, on = null) {
  const post = await contentDb.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return null;
  const had = !!(await contentDb.prepare("SELECT 1 AS x FROM likes WHERE post_id = ? AND anon_key = ?").get(postId, anonKey));
  const want = on === null ? !had : !!on;
  if (want && !had) await contentDb.prepare("INSERT INTO likes (post_id, anon_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(postId, anonKey, new Date().toISOString());
  if (!want && had) await contentDb.prepare("DELETE FROM likes WHERE post_id = ? AND anon_key = ?").run(postId, anonKey);
  const { n } = await contentDb.prepare("SELECT COUNT(*) AS n FROM likes WHERE post_id = ?").get(postId);
  return { liked: want, likeCount: Number(n), newlyLiked: want && !had };
}

export async function toggleReaction(postId, anonKey, reaction) {
  if (!isValidReaction(reaction)) return null;
  const post = await contentDb.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return null;

  const existing = await contentDb.prepare("SELECT reaction FROM reactions WHERE post_id = ? AND anon_key = ?").get(postId, anonKey);
  if (existing && existing.reaction === reaction) {
    await contentDb.prepare("DELETE FROM reactions WHERE post_id = ? AND anon_key = ?").run(postId, anonKey);
    return { reactions: await postReactionSummary(postId), myReaction: null, active: false };
  }
  const now = new Date().toISOString();
  // ON CONFLICT makes concurrent taps safe: whichever lands last wins, and
  // there is still exactly one row.
  await contentDb.prepare(
    `INSERT INTO reactions (id, post_id, anon_key, reaction, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (post_id, anon_key) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at`
  ).run(crypto.randomUUID(), postId, anonKey, reaction, now);
  return { reactions: await postReactionSummary(postId), myReaction: reaction, active: true, previous: existing?.reaction || null };
}

// Comment likes — separate table and counts from comment reactions (same model as post likes).
export async function setCommentLike(commentId, anonKey, on = null) {
  const c = await contentDb.prepare("SELECT id, post_id, anonymous_id FROM comments WHERE id = ?").get(commentId);
  if (!c) return null;
  const had = !!(await contentDb.prepare("SELECT 1 AS x FROM comment_likes WHERE comment_id = ? AND anon_key = ?").get(commentId, anonKey));
  const want = on === null ? !had : !!on;
  if (want && !had) await contentDb.prepare("INSERT INTO comment_likes (comment_id, anon_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(commentId, anonKey, new Date().toISOString());
  if (!want && had) await contentDb.prepare("DELETE FROM comment_likes WHERE comment_id = ? AND anon_key = ?").run(commentId, anonKey);
  const { n } = await contentDb.prepare("SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?").get(commentId);
  return { liked: want, likeCount: Number(n), newlyLiked: want && !had, ownerAnonymousId: c.anonymous_id, postId: c.post_id };
}

export async function toggleCommentReaction(commentId, anonKey, reaction) {
  if (!isValidReaction(reaction)) return null;
  const c = await contentDb.prepare("SELECT id, post_id, anonymous_id FROM comments WHERE id = ?").get(commentId);
  if (!c) return null;
  const existing = await contentDb.prepare("SELECT reaction FROM comment_reactions WHERE comment_id = ? AND anon_key = ?").get(commentId, anonKey);
  let active = true;
  if (existing && existing.reaction === reaction) {
    await contentDb.prepare("DELETE FROM comment_reactions WHERE comment_id = ? AND anon_key = ?").run(commentId, anonKey);
    active = false;
  } else {
    await contentDb.prepare(
      `INSERT INTO comment_reactions (id, comment_id, anon_key, reaction, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (comment_id, anon_key) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at`
    ).run(crypto.randomUUID(), commentId, anonKey, reaction, new Date().toISOString());
  }
  const summary = (await reactionSummaries("comment_reactions", "comment_id", [commentId]))[commentId] || { total: 0, top: [] };
  return { active, reactions: summary, myReaction: active ? reaction : null, ownerAnonymousId: c.anonymous_id, postId: c.post_id };
}

// Repost / un-repost. The reposts table has UNIQUE(post_id, anon_key), so an
// account can never hold two reposts of the same post — even under a burst
// of parallel requests, only one INSERT can win the claim below.
//   on === true  -> ensure reposted   (idempotent)
//   on === false -> ensure not reposted (idempotent)
//   on === null  -> flip whatever it is now
// quoteText adds/updates commentary on an existing or new repost.
export async function setRepost({ postId, anonKey, on = null, quoteText = null, authorDisplay, anonymousId }) {
  const original = await contentDb.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!original) return { error: "NOT_FOUND" };
  if (original.repost_of) return { error: "IS_REPOST" };

  const existing = await contentDb.prepare("SELECT * FROM reposts WHERE post_id = ? AND anon_key = ?").get(postId, anonKey);
  const wantOn = on === null ? (quoteText ? true : !existing) : !!on;

  const finish = async (reposted, created = false) => {
    const post = await getPostById(postId, anonKey);
    return { reposted, created, repostCount: post?.repostCount ?? 0, post };
  };

  if (!wantOn) {
    if (!existing) return finish(false);
    // Remove the repost row itself, then the record that guarded it.
    if (existing.repost_post_id) {
      await contentDb.prepare("DELETE FROM comments WHERE post_id = ?").run(existing.repost_post_id);
      await contentDb.prepare("DELETE FROM posts WHERE id = ?").run(existing.repost_post_id);
    }
    await contentDb.prepare("DELETE FROM reposts WHERE id = ?").run(existing.id);
    return finish(false);
  }

  if (existing) {
    if (quoteText && existing.repost_post_id) {
      await contentDb.prepare("UPDATE posts SET quote_text = ? WHERE id = ?").run(quoteText, existing.repost_post_id);
    }
    return finish(true);
  }

  // Claim the slot first; losing the race means someone (this same account,
  // another tab) already reposted — treat as done, don't create a second.
  const claimId = crypto.randomUUID();
  const claimed = await contentDb.prepare(
    `INSERT INTO reposts (id, post_id, anon_key, repost_post_id, created_at) VALUES (?, ?, ?, NULL, ?)
     ON CONFLICT (post_id, anon_key) DO NOTHING RETURNING id`
  ).get(claimId, postId, anonKey, new Date().toISOString());
  if (!claimed) return finish(true);

  try {
    const repost = await createPost({
      type: original.type, mood: original.mood, text: "", tags: [],
      authorDisplay, anonymousId, visibility: "public", repostOf: postId, quoteText,
    });
    await contentDb.prepare("UPDATE reposts SET repost_post_id = ? WHERE id = ?").run(repost.id, claimId);
  } catch (e) {
    await contentDb.prepare("DELETE FROM reposts WHERE id = ?").run(claimId);
    throw e;
  }
  return finish(true, true);
}

export async function getPostAnonymousId(id) {
  const row = await contentDb.prepare("SELECT anonymous_id FROM posts WHERE id = ?").get(id);
  return row ? row.anonymous_id : null;
}

// Public profile for an alias handle — the "click a poster's name" page.
// Deliberately narrow: only ever resolves for a stable 'alias' identity
// (getAliasHandle refuses anything else), and only returns their public
// posts, a display label, and simple aggregate counts. No real name, no
// email, no account id, no verification status, nothing from 'real' or
// 'anon' mode posts even if the same account also posts that way.
export async function getPublicAliasProfile(anonymousId, viewerAnonKey = null) {
  const rows = await contentDb.prepare(
    "SELECT * FROM posts WHERE anonymous_id = ? AND repost_of IS NULL AND visibility = 'public' ORDER BY created_at DESC LIMIT 50"
  ).all(anonymousId);
  const totalReactions = Number((await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.anonymous_id = ?"
  ).get(anonymousId)).n);
  return {
    posts: await Promise.all(rows.map(async (row) => rowToPost(row, await attachReactionAndPoll(row, viewerAnonKey)))),
    postCount: rows.length,
    totalReactions,
  };
}

export async function getPostsByOwnership(anonymousIds = [], authorDisplayExact = null, viewerAnonKey = null) {
  const clauses = [];
  const params = [];
  if (anonymousIds.length > 0) {
    clauses.push(`anonymous_id IN (${anonymousIds.map(() => "?").join(",")})`);
    params.push(...anonymousIds);
  }
  if (authorDisplayExact) {
    clauses.push("(anonymous_id IS NULL AND author_display = ?)");
    params.push(authorDisplayExact);
  }
  if (clauses.length === 0) return [];
  const rows = await contentDb.prepare(
    `SELECT * FROM posts WHERE ${clauses.join(" OR ")} ORDER BY pinned DESC, created_at DESC`
  ).all(...params);
  return Promise.all(rows.map(async (row) => rowToPost(row, await attachReactionAndPoll(row, viewerAnonKey))));
}

export async function countPostsByAnonymousIds(anonymousIds = []) {
  if (anonymousIds.length === 0) return 0;
  const placeholders = anonymousIds.map(() => "?").join(",");
  return (await contentDb.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE anonymous_id IN (${placeholders}) AND repost_of IS NULL`
  ).get(...anonymousIds)).n;
}

export async function countRepostsByAnonymousIds(anonymousIds = []) {
  if (anonymousIds.length === 0) return 0;
  const placeholders = anonymousIds.map(() => "?").join(",");
  return (await contentDb.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE anonymous_id IN (${placeholders}) AND repost_of IS NOT NULL`
  ).get(...anonymousIds)).n;
}

// mediaPath here is the FULL object-storage URL (public bucket) — see
// savePostMedia() in lib/media.js. Column name kept as media_path to
// avoid an unrelated rename.
export async function attachMediaToPost(postId, mediaType, mediaPath) {
  await contentDb.prepare("UPDATE posts SET media_type = ?, media_path = ? WHERE id = ?").run(mediaType, mediaPath, postId);
  return getPostById(postId);
}

// ---------------- Comments ----------------

export async function createComment({ postId, anonymousId, authorDisplay, text, mediaType = null, mediaPath = null, gifUrl = null, createdAt }) {
  const post = await contentDb.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return null;
  const id = crypto.randomUUID();
  const now = createdAt || new Date().toISOString();
  await contentDb.prepare(
    "INSERT INTO comments (id, post_id, anonymous_id, author_display, text, media_type, media_path, gif_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, postId, anonymousId, authorDisplay, text, mediaType, mediaPath, gifUrl, now);
  await contentDb.prepare("UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?").run(postId);
  return attachCommentExtras(rowToComment({
    id, post_id: postId, author_display: authorDisplay, text,
    media_type: mediaType, media_path: mediaPath, gif_url: gifUrl, created_at: now,
  }), anonymousId);
}

async function attachCommentExtras(comment, anonymousId) {
  const alias = await getAliasHandle(anonymousId);
  return { ...comment, authorHandle: alias ? alias.anonymousId : null, authorAvatarUrl: alias ? alias.avatarUrl : null, authorTier: alias ? alias.tier : "basic" };
}

export async function getComments(postId, viewerAnonKey = null) {
  const rows = await contentDb.prepare(
    "SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC"
  ).all(postId);
  const comments = await Promise.all(rows.map(async (row) => attachCommentExtras(rowToComment(row), row.anonymous_id)));
  const ids = comments.map((c) => c.id);
  const summaries = await reactionSummaries("comment_reactions", "comment_id", ids);
  let mine = {};
  if (viewerAnonKey && ids.length) {
    const ph = ids.map(() => "?").join(",");
    const rs = await contentDb.prepare(`SELECT comment_id, reaction FROM comment_reactions WHERE comment_id IN (${ph}) AND anon_key = ?`).all(...ids, viewerAnonKey);
    mine = Object.fromEntries(rs.map((r) => [r.comment_id, r.reaction]));
  }
  const likeRows = ids.length ? await contentDb.prepare(`SELECT comment_id, COUNT(*) AS n FROM comment_likes WHERE comment_id IN (${ids.map(() => "?").join(",")}) GROUP BY comment_id`).all(...ids) : [];
  const likeCount = Object.fromEntries(likeRows.map((r) => [r.comment_id, Number(r.n)]));
  let myLikes = new Set();
  if (viewerAnonKey && ids.length) myLikes = new Set((await contentDb.prepare(`SELECT comment_id FROM comment_likes WHERE comment_id IN (${ids.map(() => "?").join(",")}) AND anon_key = ?`).all(...ids, viewerAnonKey)).map((r) => r.comment_id));
  return comments.map((c) => ({ ...c, reactions: summaries[c.id] || { total: 0, top: [] }, myReaction: mine[c.id] || null, likeCount: likeCount[c.id] || 0, myLike: myLikes.has(c.id) }));
}

// relativePath here is the FULL object-storage URL (public bucket) — see
// savePostMedia() in lib/media.js. Kept the parameter name for backward
// compatibility with existing call sites.
export async function attachMediaToComment(commentId, kind, relativePath) {
  await contentDb.prepare("UPDATE comments SET media_type = ?, media_path = ? WHERE id = ?").run(kind, relativePath, commentId);
  const row = await contentDb.prepare("SELECT * FROM comments WHERE id = ?").get(commentId);
  return attachCommentExtras(rowToComment(row), row.anonymous_id);
}

export async function getCommentMediaPath(commentId) {
  const row = await contentDb.prepare("SELECT media_path FROM comments WHERE id = ?").get(commentId);
  return row?.media_path || null;
}

export async function countCommentsByAnonymousIds(anonymousIds = []) {
  if (anonymousIds.length === 0) return 0;
  const placeholders = anonymousIds.map(() => "?").join(",");
  return (await contentDb.prepare(
    `SELECT COUNT(*) AS n FROM comments WHERE anonymous_id IN (${placeholders})`
  ).get(...anonymousIds)).n;
}

// ---------------- Polls ----------------

export async function votePoll(postId, anonKey, optionIndex) {
  const post = await contentDb.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || post.type !== "poll") return null;
  const option = await contentDb.prepare(
    "SELECT * FROM poll_options WHERE post_id = ? AND option_index = ?"
  ).get(postId, optionIndex);
  if (!option) return null;

  if (post.multi_select) {
    // Multi-select: this option toggles independently — voting for one
    // option never touches any other option this person already picked.
    const existingThisOption = await contentDb.prepare(
      "SELECT 1 FROM poll_votes WHERE post_id = ? AND anon_key = ? AND option_index = ?"
    ).get(postId, anonKey, optionIndex);

    if (existingThisOption) {
      await contentDb.prepare("UPDATE poll_options SET votes = GREATEST(0, votes - 1) WHERE post_id = ? AND option_index = ?")
        .run(postId, optionIndex);
      await contentDb.prepare("DELETE FROM poll_votes WHERE post_id = ? AND anon_key = ? AND option_index = ?")
        .run(postId, anonKey, optionIndex);
    } else {
      await contentDb.prepare(
        "INSERT INTO poll_votes (id, post_id, anon_key, option_index, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(crypto.randomUUID(), postId, anonKey, optionIndex, new Date().toISOString());
      await contentDb.prepare("UPDATE poll_options SET votes = votes + 1 WHERE post_id = ? AND option_index = ?").run(postId, optionIndex);
    }
    return getPostById(postId, anonKey);
  }

  // Single-select (original behavior): at most one active vote per
  // person — picking a new option replaces whichever one they had.
  const existing = await contentDb.prepare(
    "SELECT option_index FROM poll_votes WHERE post_id = ? AND anon_key = ?"
  ).get(postId, anonKey);

  if (existing && existing.option_index === optionIndex) {
    // Tapping your own already-selected option again removes your vote
    // entirely, X/LinkedOut-poll style, instead of being a no-op.
    await contentDb.prepare("UPDATE poll_options SET votes = GREATEST(0, votes - 1) WHERE post_id = ? AND option_index = ?")
      .run(postId, optionIndex);
    await contentDb.prepare("DELETE FROM poll_votes WHERE post_id = ? AND anon_key = ?").run(postId, anonKey);
    return getPostById(postId, anonKey);
  }
  if (existing) {
    await contentDb.prepare("UPDATE poll_options SET votes = GREATEST(0, votes - 1) WHERE post_id = ? AND option_index = ?")
      .run(postId, existing.option_index);
    await contentDb.prepare("UPDATE poll_votes SET option_index = ?, created_at = ? WHERE post_id = ? AND anon_key = ?")
      .run(optionIndex, new Date().toISOString(), postId, anonKey);
  } else {
    await contentDb.prepare(
      "INSERT INTO poll_votes (id, post_id, anon_key, option_index, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), postId, anonKey, optionIndex, new Date().toISOString());
  }
  await contentDb.prepare("UPDATE poll_options SET votes = votes + 1 WHERE post_id = ? AND option_index = ?").run(postId, optionIndex);
  return getPostById(postId, anonKey);
}

// ---------------- Cringe Awards (a ranked view of real posts, not a separate table) ----------------

export async function voteCringe(postId, anonKey) {
  const post = await contentDb.prepare("SELECT * FROM posts WHERE id = ?").get(postId);
  if (!post || !post.cringe_nominated) return null;
  const existing = await contentDb.prepare(
    "SELECT 1 FROM cringe_votes WHERE post_id = ? AND anon_key = ?"
  ).get(postId, anonKey);
  if (existing) return getPostById(postId);
  await contentDb.prepare(
    "INSERT INTO cringe_votes (id, post_id, anon_key, created_at) VALUES (?, ?, ?, ?)"
  ).run(crypto.randomUUID(), postId, anonKey, new Date().toISOString());
  await contentDb.prepare("UPDATE posts SET cringe_votes = cringe_votes + 1 WHERE id = ?").run(postId);
  return getPostById(postId);
}

export async function getCringeLeaderboard(limit = 20) {
  const rows = await contentDb.prepare(
    "SELECT * FROM posts WHERE cringe_nominated = 1 ORDER BY cringe_votes DESC, created_at DESC LIMIT ?"
  ).all(limit);
  return Promise.all(rows.map(async (row, i) => rowToPost(row, { ...(await attachReactionAndPoll(row, null)), rank: i + 1 })));
}

export async function getTopCringePostAnonymousId() {
  const row = await contentDb.prepare(
    "SELECT anonymous_id FROM posts WHERE cringe_nominated = 1 AND cringe_votes > 0 ORDER BY cringe_votes DESC, created_at DESC LIMIT 1"
  ).get();
  return row ? row.anonymous_id : null;
}

// ---------------- Companies ----------------

export function normalizeCompanyName(name) {
  return String(name || "").toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|plc|gmbh|corp|corporation|co|company|sa|ag|bv|pty)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
}

// Back-compat path used by seed scripts: a plain, unverified, active page.
export async function createCompany({ name, industry, description, anonymousId, authorDisplay, createdAt }) {
  const id = crypto.randomUUID();
  const now = createdAt || new Date().toISOString();
  await contentDb.prepare(
    `INSERT INTO companies (id, name, industry, description, created_by_anonymous_id, created_by_display, created_at,
       owner_key, name_norm, status, verification, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'unverified', ?)`
  ).run(id, name, industry || null, description || null, anonymousId, authorDisplay, now, anonymousId, normalizeCompanyName(name), now);
  return getCompanyById(id);
}

async function companySummary(row) {
  const greenFlags = (await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM company_reviews WHERE company_id = ? AND flag_type = 'green'"
  ).get(row.id)).n;
  const redFlags = (await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM company_reviews WHERE company_id = ? AND flag_type = 'red'"
  ).get(row.id)).n;
  const salaryStats = await contentDb.prepare(
    "SELECT MIN(amount) AS min, MAX(amount) AS max, COUNT(*) AS n FROM company_salaries WHERE company_id = ?"
  ).get(row.id);
  const ratingStats = await contentDb.prepare(
    "SELECT AVG(rating) AS avg, COUNT(rating) AS n FROM company_reviews WHERE company_id = ? AND rating IS NOT NULL"
  ).get(row.id);
  const reviewCount = (await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM company_reviews WHERE company_id = ?"
  ).get(row.id)).n;
  const layoffCount = (await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM company_horror_stories WHERE company_id = ? AND story ILIKE '%layoff%'"
  ).get(row.id)).n;
  return {
    id: row.id,
    name: row.name,
    industry: row.industry,
    description: row.description,
    legalName: row.legal_name || null,
    website: row.website || null,
    headquarters: row.headquarters || null,
    sizeRange: row.size_range || null,
    foundedYear: row.founded_year || null,
    registrationCountry: row.registration_country || null,
    // Public trust signals. "verified" = documents reviewed by a human;
    // domainVerified = owner proved control of an email at the company's site.
    verification: row.verification || "unverified",
    domainVerified: !!row.domain_verified,
    verifiedAt: row.verified_at || null,
    status: row.status || "active",
    createdBy: row.created_by_display,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    greenFlags,
    redFlags,
    reviewCount,
    avgRating: ratingStats.n > 0 ? Math.round(ratingStats.avg * 10) / 10 : null,
    ratingCount: ratingStats.n,
    toxic: redFlags >= 10 && redFlags > greenFlags * 2,
    layoffBadge: layoffCount > 0,
    salaryRange: salaryStats.n > 0 ? `$${Math.round(salaryStats.min / 1000)}k – $${Math.round(salaryStats.max / 1000)}k` : "no data yet",
    salarySamples: salaryStats.n,
  };
}

export async function getCompanies(viewerKey = null) {
  const rows = await contentDb.prepare(
    `SELECT * FROM companies WHERE status = 'active'
     ORDER BY (verification = 'verified') DESC, domain_verified DESC, created_at DESC`
  ).all();
  const out = await Promise.all(rows.map(companySummary));
  return out.map((c, i) => ({ ...c, isOwner: !!viewerKey && rows[i].owner_key === viewerKey }));
}

// Pages this account owns, including ones in their 30-day restore window.
export async function getMyCompanies(ownerKey) {
  await purgeExpiredCompanies();
  const rows = await contentDb.prepare("SELECT * FROM companies WHERE owner_key = ? ORDER BY created_at DESC").all(ownerKey);
  return Promise.all(rows.map(async (r) => ({
    ...(await companySummary(r)), isOwner: true, deletedAt: r.deleted_at || null,
    restorableUntil: r.deleted_at ? new Date(new Date(r.deleted_at).getTime() + 30 * 864e5).toISOString() : null,
  })));
}

export async function getCompanyById(id, viewerKey = null) {
  const row = await contentDb.prepare("SELECT * FROM companies WHERE id = ?").get(id);
  if (!row) return null;
  const isOwner = !!viewerKey && row.owner_key === viewerKey;
  // Deleted and suspended pages are invisible to everyone but their owner.
  if (row.status !== "active" && !isOwner) return null;
  const summary = await companySummary(row);
  const tags = await contentDb.prepare(
    `SELECT flag_type AS type, tag_text AS text, COUNT(*) AS n FROM company_reviews
     WHERE company_id = ? GROUP BY flag_type, tag_text ORDER BY n DESC`
  ).all(id);
  // Full individual reviews — each has an id so it can be reported.
  const reviews = await contentDb.prepare(
    `SELECT id, author_display AS author, flag_type AS "flagType", tag_text AS "tagText", body, rating, created_at AS "createdAt"
     FROM company_reviews WHERE company_id = ? ORDER BY created_at DESC`
  ).all(id);
  const salaries = await contentDb.prepare(
    `SELECT role_title AS "roleTitle", amount, created_at AS "createdAt"
     FROM company_salaries WHERE company_id = ? ORDER BY created_at DESC`
  ).all(id);
  const horrorStories = await contentDb.prepare(
    'SELECT id, author_display AS author, story, created_at AS "createdAt" FROM company_horror_stories WHERE company_id = ? ORDER BY created_at DESC'
  ).all(id);
  const result = { ...summary, isOwner, tags, reviews, salaries, horrorStories };
  if (isOwner) {
    const docs = await contentDb.prepare(
      'SELECT id, doc_type AS "docType", filename, size_bytes AS "sizeBytes", created_at AS "createdAt" FROM company_documents WHERE company_id = ? ORDER BY created_at DESC'
    ).all(id);
    const openDisputes = Number((await contentDb.prepare("SELECT COUNT(*) AS n FROM company_disputes WHERE company_id = ? AND status = 'open'").get(id)).n);
    const audit = await contentDb.prepare(
      'SELECT action, detail, created_at AS "createdAt" FROM company_audit WHERE company_id = ? ORDER BY created_at DESC LIMIT 25'
    ).all(id);
    result.owner = {
      registrationNumber: row.registration_number, contactEmail: row.contact_email, relationship: row.relationship,
      verificationNote: row.verification_note, termsVersion: row.terms_version, termsAcceptedAt: row.terms_accepted_at,
      deletedAt: row.deleted_at, documents: docs, openDisputes, audit,
      nameChangeAvailableAt: row.name_changed_at ? new Date(new Date(row.name_changed_at).getTime() + 30 * 864e5).toISOString() : null,
    };
  }
  return result;
}

// Erases pages whose 30-day restore window has passed (and their private
// documents), unless an open dispute is keeping them on record.
export async function purgeExpiredCompanies() {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = await contentDb.prepare(
    `SELECT id FROM companies WHERE status = 'deleted' AND deleted_at < ?
       AND NOT EXISTS (SELECT 1 FROM company_disputes d WHERE d.company_id = companies.id AND d.status = 'open')`
  ).all(cutoff);
  for (const { id } of rows) await eraseCompany(id);
  return rows.length;
}

export async function eraseCompany(id) {
  const docs = await contentDb.prepare("SELECT file_key FROM company_documents WHERE company_id = ?").all(id);
  try {
    const { deletePrivateObject } = await import("../storage.js");
    for (const d of docs) await deletePrivateObject(d.file_key).catch(() => {});
  } catch { /* storage not configured */ }
  for (const t of ["company_documents", "company_audit", "company_disputes", "company_domain_codes", "company_reviews", "company_salaries", "company_horror_stories"]) {
    await contentDb.prepare(`DELETE FROM ${t} WHERE company_id = ?`).run(id);
  }
  await contentDb.prepare("DELETE FROM companies WHERE id = ?").run(id);
}

export async function addCompanyReview({ companyId, anonymousId, authorDisplay, flagType, tagText, body, rating, createdAt }) {
  const company = await contentDb.prepare("SELECT id FROM companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!company) return null;
  await contentDb.prepare(
    "INSERT INTO company_reviews (id, company_id, anonymous_id, author_display, flag_type, tag_text, body, rating, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), companyId, anonymousId, authorDisplay, flagType, tagText, body || null, rating || null, createdAt || new Date().toISOString());
  return getCompanyById(companyId);
}

export async function addCompanySalary({ companyId, anonymousId, roleTitle, amount, createdAt }) {
  const company = await contentDb.prepare("SELECT id FROM companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!company) return null;
  await contentDb.prepare(
    "INSERT INTO company_salaries (id, company_id, anonymous_id, role_title, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), companyId, anonymousId, roleTitle || null, amount, createdAt || new Date().toISOString());
  return getCompanyById(companyId);
}

export async function addCompanyHorrorStory({ companyId, anonymousId, authorDisplay, story, createdAt }) {
  const company = await contentDb.prepare("SELECT id FROM companies WHERE id = ? AND status = 'active'").get(companyId);
  if (!company) return null;
  await contentDb.prepare(
    "INSERT INTO company_horror_stories (id, company_id, anonymous_id, author_display, story, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), companyId, anonymousId, authorDisplay, story, createdAt || new Date().toISOString());
  return getCompanyById(companyId);
}

// ---------------- Jobs ----------------

export async function createJob({ title, companyName, salaryMin, salaryMax, lastPersonQuitReason, anonymousId, authorDisplay, createdAt }) {
  const id = crypto.randomUUID();
  await contentDb.prepare(
    `INSERT INTO jobs (id, title, company_name, salary_min, salary_max, last_person_quit_reason, created_by_anonymous_id, created_by_display, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, companyName, salaryMin || null, salaryMax || null, lastPersonQuitReason || null, anonymousId, authorDisplay, createdAt || new Date().toISOString());
  return getJobById(id);
}

function jobSummary(row) {
  const disclosed = row.salary_min != null && row.salary_max != null;
  const honestyReasonLength = (row.last_person_quit_reason || "").length;
  let honesty = 20;
  if (disclosed) honesty += 45;
  if (honestyReasonLength > 60) honesty += 35;
  else if (honestyReasonLength > 20) honesty += 15;
  honesty = Math.min(100, honesty);

  return {
    id: row.id,
    title: row.title,
    company: row.company_name,
    salary: disclosed ? `$${row.salary_min.toLocaleString()} – $${row.salary_max.toLocaleString()}` : "$0 – $0 — flagged: no range provided",
    lastPersonQuit: row.last_person_quit_reason || "— not disclosed —",
    ghosted: !disclosed,
    honesty,
    postedBy: row.created_by_display,
    createdAt: row.created_at,
  };
}

export async function getJobs() {
  const rows = await contentDb.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all();
  // Postings with no disclosed salary range are genuinely buried, not just
  // labeled as such — sorted after every disclosed posting, matching what
  // the Jobs page tells people happens.
  const disclosed = rows.filter((r) => r.salary_min != null && r.salary_max != null);
  const undisclosed = rows.filter((r) => r.salary_min == null || r.salary_max == null);
  return [...disclosed, ...undisclosed].map(jobSummary);
}

export async function getJobById(id) {
  const row = await contentDb.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? jobSummary(row) : null;
}

// ---------------- Vent Sessions (rooms) ----------------
// Real social/data layer (creation, joining, leaving all persist and
// reflect genuine distinct accounts) — actual audio transport is
// explicitly NOT implemented; see README.

const PRESENCE_WINDOW_MS = 2 * 60 * 1000;   // a participant who hasn't checked in for 2 min is treated as gone
const EMPTY_ROOM_AUTO_END_MS = 20 * 60 * 1000; // a room nobody is in for 20 min closes itself

function roomErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export async function createRoom({ topic, vibe, startsAt, anonymousId, authorDisplay, createdAt }) {
  const id = crypto.randomUUID();
  const now = createdAt || new Date().toISOString();
  await contentDb.prepare(
    "INSERT INTO rooms (id, topic, vibe, starts_at, created_by_anonymous_id, created_by_display, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'live')"
  ).run(id, topic, vibe, startsAt || null, anonymousId, authorDisplay, now);
  // The creator is the room's host from the moment it exists.
  if (anonymousId) {
    await contentDb.prepare(
      "INSERT INTO room_participants (id, room_id, anon_key, joined_at, last_seen_at, role) VALUES (?, ?, ?, ?, ?, 'host')"
    ).run(crypto.randomUUID(), id, anonymousId, now, now);
  }
  return getRoomById(id, anonymousId);
}

async function roomSummary(row, viewerKey = null) {
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
  const activeCount = Number((await contentDb.prepare(
    "SELECT COUNT(*) AS n FROM room_participants WHERE room_id = ? AND left_at IS NULL AND COALESCE(last_seen_at, joined_at) > ?"
  ).get(row.id, cutoff)).n);
  const ended = row.status === "ended";
  const started = row.starts_at ? new Date(row.starts_at).getTime() <= Date.now() : true;
  return {
    id: row.id,
    topic: row.topic,
    vibe: row.vibe,
    storyId: row.story_id || null,
    circleId: row.circle_id || null,
    status: ended ? "ended" : "live",
    ended,
    endedAt: row.ended_at || null,
    live: !ended && started,
    locked: !!row.locked,
    startsAt: row.starts_at,
    listeners: ended ? 0 : activeCount,
    createdBy: row.created_by_display,
    createdAt: row.created_at,
    // Only ever true for the viewer's own request — a room never reveals
    // who its host is to anyone else beyond the display label.
    isHost: !!viewerKey && row.created_by_anonymous_id === viewerKey,
  };
}

// A room that has been empty for a while closes itself, so abandoned
// sessions (host closed the app) don't sit in the list forever.
async function autoEndStaleRooms() {
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - EMPTY_ROOM_AUTO_END_MS).toISOString();
  await contentDb.prepare(
    `UPDATE rooms SET status = 'ended', ended_at = ?
     WHERE status = 'live' AND created_at < ?
       AND COALESCE((SELECT MAX(COALESCE(rp.last_seen_at, rp.joined_at)) FROM room_participants rp
                     WHERE rp.room_id = rooms.id AND rp.left_at IS NULL), rooms.created_at) < ?`
  ).run(now, cutoff, cutoff);
}

// Live rooms are visible to everyone; an ended room is visible only to its
// own host (who can then delete it).
export async function getRooms(viewerKey = null) {
  await autoEndStaleRooms();
  const rows = await contentDb.prepare(
    "SELECT * FROM rooms WHERE status = 'live' OR (status = 'ended' AND created_by_anonymous_id = ?) ORDER BY (status = 'live') DESC, created_at DESC"
  ).all(viewerKey || "");
  return Promise.all(rows.map((r) => roomSummary(r, viewerKey)));
}

export async function getRoomById(id, viewerKey = null) {
  const row = await contentDb.prepare("SELECT * FROM rooms WHERE id = ?").get(id);
  return row ? roomSummary(row, viewerKey) : null;
}

export async function joinRoom(roomId, anonKey) {
  const room = await contentDb.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
  if (!room) return null;
  if (room.status === "ended") throw roomErr("ROOM_ENDED", "The host has ended this session.");
  const banned = await contentDb.prepare("SELECT 1 AS x FROM room_bans WHERE room_id = ? AND anon_key = ?").get(roomId, anonKey);
  if (banned) throw roomErr("BANNED", "The host removed you from this session.");

  const isHost = room.created_by_anonymous_id === anonKey;
  const now = new Date().toISOString();
  const active = await contentDb.prepare(
    "SELECT id FROM room_participants WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).get(roomId, anonKey);
  if (active) {
    await contentDb.prepare("UPDATE room_participants SET last_seen_at = ? WHERE id = ?").run(now, active.id);
  } else {
    if (room.locked && !isHost) throw roomErr("LOCKED", "The host has locked this session.");
    // Whoever created the room is always its host, including when they
    // leave and come back — never demoted to listener by rejoining.
    await contentDb.prepare(
      "INSERT INTO room_participants (id, room_id, anon_key, role, joined_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), roomId, anonKey, isHost ? "host" : "listener", now, now);
  }
  return getRoomById(roomId, anonKey);
}

export async function leaveRoom(roomId, anonKey) {
  await contentDb.prepare(
    "UPDATE room_participants SET left_at = ?, hand_raised = 0 WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).run(new Date().toISOString(), roomId, anonKey);
  return getRoomById(roomId, anonKey);
}

// Presence heartbeat — called whenever a joined client checks in.
export async function touchParticipant(roomId, anonKey) {
  if (!anonKey) return;
  await contentDb.prepare(
    "UPDATE room_participants SET last_seen_at = ? WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).run(new Date().toISOString(), roomId, anonKey);
}

// ---------------- Vent Room speaker moderation ----------------

export async function getMyRoomRole(roomId, anonKey) {
  if (!anonKey) return null;
  const row = await contentDb.prepare(
    "SELECT role, hand_raised FROM room_participants WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).get(roomId, anonKey);
  return row ? { role: row.role, handRaised: !!row.hand_raised } : null;
}

// Each participant's display label comes from their own alias — same
// boundary reasoning as everywhere else identity is shown next to content.
export async function getRoomParticipants(roomId) {
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
  const rows = await contentDb.prepare(
    `SELECT anon_key, role, hand_raised, joined_at FROM room_participants
     WHERE room_id = ? AND left_at IS NULL AND COALESCE(last_seen_at, joined_at) > ?
     ORDER BY CASE role WHEN 'host' THEN 0 WHEN 'speaker' THEN 1 ELSE 2 END, joined_at ASC`
  ).all(roomId, cutoff);
  const aliases = await getAliasHandles(rows.map((r) => r.anon_key));
  return rows.map((r) => {
    const alias = aliases.get(r.anon_key);
    return {
      handle: r.anon_key,
      displayLabel: alias?.displayLabel || "Anonymous",
      avatarUrl: alias?.avatarUrl || null,
      role: r.role,
      handRaised: !!r.hand_raised,
    };
  });
}

export async function raiseHand(roomId, anonKey, raised = true) {
  await contentDb.prepare(
    "UPDATE room_participants SET hand_raised = ? WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).run(raised ? 1 : 0, roomId, anonKey);
  return getMyRoomRole(roomId, anonKey);
}

// The host is whoever CREATED the room. Checked against the room row, not
// the participant list, so it still works after the session has ended and
// everyone (including the host) has been marked as left.
async function requireHost(roomId, requestorAnonKey) {
  const room = await contentDb.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
  if (!room) throw roomErr("NOT_FOUND", "Room not found.");
  if (!requestorAnonKey || room.created_by_anonymous_id !== requestorAnonKey) {
    throw roomErr("NOT_HOST", "Only the room host can do that.");
  }
  return room;
}

async function requireLive(room) {
  if (room.status === "ended") throw roomErr("ROOM_ENDED", "This session has ended.");
}

async function activeTarget(roomId, targetAnonKey) {
  const target = await contentDb.prepare(
    "SELECT role FROM room_participants WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).get(roomId, targetAnonKey);
  if (!target) throw roomErr("NOT_FOUND", "That person isn't in the room.");
  return target;
}

export async function promoteToSpeaker(roomId, requestorAnonKey, targetAnonKey) {
  const room = await requireHost(roomId, requestorAnonKey);
  await requireLive(room);
  await activeTarget(roomId, targetAnonKey);
  await contentDb.prepare(
    "UPDATE room_participants SET role = 'speaker', hand_raised = 0 WHERE room_id = ? AND anon_key = ? AND left_at IS NULL AND role != 'host'"
  ).run(roomId, targetAnonKey);

  const targetAccountId = await resolveAliasAccountId(targetAnonKey);
  if (targetAccountId) await createNotification(targetAccountId, "room_promoted", "You've been given the mic in a Vent Room.");
  return getRoomParticipants(roomId);
}

export async function demoteToListener(roomId, requestorAnonKey, targetAnonKey) {
  const room = await requireHost(roomId, requestorAnonKey);
  await requireLive(room);
  const target = await activeTarget(roomId, targetAnonKey);
  if (target.role === "host") throw roomErr("CANNOT_DEMOTE_HOST", "The host can't be muted.");
  await contentDb.prepare(
    "UPDATE room_participants SET role = 'listener', hand_raised = 0 WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).run(roomId, targetAnonKey);

  const targetAccountId = await resolveAliasAccountId(targetAnonKey);
  if (targetAccountId) await createNotification(targetAccountId, "room_muted", "The host muted your mic in a Vent Room.");
  return getRoomParticipants(roomId);
}

// Takes the mic from every speaker at once. Returns who was muted so the
// caller can revoke their publish permission on the media server too.
export async function muteAllSpeakers(roomId, requestorAnonKey) {
  const room = await requireHost(roomId, requestorAnonKey);
  await requireLive(room);
  const speakers = await contentDb.prepare(
    "SELECT anon_key FROM room_participants WHERE room_id = ? AND role = 'speaker' AND left_at IS NULL"
  ).all(roomId);
  await contentDb.prepare(
    "UPDATE room_participants SET role = 'listener', hand_raised = 0 WHERE room_id = ? AND role = 'speaker' AND left_at IS NULL"
  ).run(roomId);
  return { mutedKeys: speakers.map((r) => r.anon_key), participants: await getRoomParticipants(roomId) };
}

// Removes someone from the session; with ban=true they can't come back.
export async function removeParticipant(roomId, requestorAnonKey, targetAnonKey, { ban = true } = {}) {
  const room = await requireHost(roomId, requestorAnonKey);
  await requireLive(room);
  const target = await activeTarget(roomId, targetAnonKey);
  if (target.role === "host") throw roomErr("CANNOT_REMOVE_HOST", "The host can't be removed.");
  await contentDb.prepare(
    "UPDATE room_participants SET left_at = ?, hand_raised = 0 WHERE room_id = ? AND anon_key = ? AND left_at IS NULL"
  ).run(new Date().toISOString(), roomId, targetAnonKey);
  if (ban) {
    await contentDb.prepare(
      "INSERT INTO room_bans (room_id, anon_key, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING"
    ).run(roomId, targetAnonKey, new Date().toISOString());
  }
  const targetAccountId = await resolveAliasAccountId(targetAnonKey);
  if (targetAccountId) await createNotification(targetAccountId, "room_removed", "The host removed you from a Vent Room.");
  return getRoomParticipants(roomId);
}

export async function updateRoomSettings(roomId, requestorAnonKey, { topic, vibe, locked }) {
  const room = await requireHost(roomId, requestorAnonKey);
  await requireLive(room);
  const nextTopic = typeof topic === "string" && topic.trim() ? topic.trim().slice(0, 140) : room.topic;
  const nextVibe = typeof vibe === "string" && vibe.trim() ? vibe.trim().slice(0, 40) : room.vibe;
  const nextLocked = typeof locked === "boolean" ? (locked ? 1 : 0) : room.locked;
  await contentDb.prepare("UPDATE rooms SET topic = ?, vibe = ?, locked = ? WHERE id = ?").run(nextTopic, nextVibe, nextLocked, roomId);
  return getRoomById(roomId, requestorAnonKey);
}

// Closes the session for everyone. The room row stays (as "ended", visible
// only to the host) until the host deletes it.
export async function endRoom(roomId, requestorAnonKey) {
  const room = await requireHost(roomId, requestorAnonKey);
  if (room.status === "ended") return { room: await getRoomById(roomId, requestorAnonKey), notifyKeys: [] };
  const others = await contentDb.prepare(
    "SELECT anon_key FROM room_participants WHERE room_id = ? AND left_at IS NULL AND anon_key != ?"
  ).all(roomId, requestorAnonKey);
  const now = new Date().toISOString();
  await contentDb.prepare("UPDATE rooms SET status = 'ended', ended_at = ? WHERE id = ?").run(now, roomId);
  await contentDb.prepare("UPDATE room_participants SET left_at = ?, hand_raised = 0 WHERE room_id = ? AND left_at IS NULL").run(now, roomId);

  for (const { anon_key } of others) {
    const accountId = await resolveAliasAccountId(anon_key);
    if (accountId) await createNotification(accountId, "room_ended", `The host ended "${room.topic}".`);
  }
  return { room: await getRoomById(roomId, requestorAnonKey), notifyKeys: others.map((o) => o.anon_key) };
}

// Permanent removal. Two-step by design: a session must be ended first, so
// a live conversation can never be wiped out by one stray tap.
export async function deleteRoom(roomId, requestorAnonKey) {
  const room = await requireHost(roomId, requestorAnonKey);
  if (room.status !== "ended") throw roomErr("NOT_ENDED", "End the session before deleting it.");
  await contentDb.prepare("DELETE FROM room_participants WHERE room_id = ?").run(roomId);
  await contentDb.prepare("DELETE FROM room_bans WHERE room_id = ?").run(roomId);
  await contentDb.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
  return { deleted: true };
}

// ---------------- Search ----------------

export async function searchContent(query) {
  const blocked = await contentDb.prepare("SELECT term FROM blocked_terms").all();
  if (blocked.some((b) => query.toLowerCase().includes(b.term))) return { posts: [], companies: [], jobs: [], rooms: [] };
  const like = `%${query}%`;
  const posts = await contentDb.prepare(
    "SELECT id, author_display AS author, text, title FROM posts WHERE repost_of IS NULL AND visibility <> 'removed' AND (text ILIKE ? OR title ILIKE ?) ORDER BY created_at DESC LIMIT 10"
  ).all(like, like);
  const companies = await contentDb.prepare(
    "SELECT id, name, industry FROM companies WHERE name ILIKE ? OR industry ILIKE ? ORDER BY created_at DESC LIMIT 10"
  ).all(like, like);
  const jobs = await contentDb.prepare(
    'SELECT id, title, company_name AS company FROM jobs WHERE title ILIKE ? OR company_name ILIKE ? ORDER BY created_at DESC LIMIT 10'
  ).all(like, like);
  const rooms = await contentDb.prepare(
    "SELECT id, topic, vibe FROM rooms WHERE topic ILIKE ? ORDER BY created_at DESC LIMIT 10"
  ).all(like);
  return { posts, companies, jobs, rooms };
}

// ---------------- Bookmarks & Likes history ----------------
// Both keyed by anon_key, the account's own persistent alias identity —
// same dedup pattern as reactions, same self-service reasoning as "my
// posts": an account looking up its OWN bookmarks/likes via its OWN key
// is not the same operation break-glass exists to gate.

export async function toggleBookmark(postId, anonKey) {
  const post = await contentDb.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return null;
  const existing = await contentDb.prepare("SELECT id FROM bookmarks WHERE post_id = ? AND anon_key = ?").get(postId, anonKey);
  if (existing) {
    await contentDb.prepare("DELETE FROM bookmarks WHERE id = ?").run(existing.id);
    return { bookmarked: false };
  }
  await contentDb.prepare("INSERT INTO bookmarks (id, post_id, anon_key, created_at) VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), postId, anonKey, new Date().toISOString());
  return { bookmarked: true };
}

export async function getBookmarkedPosts(anonKey) {
  const rows = await contentDb.prepare(
    `SELECT p.* FROM bookmarks b JOIN posts p ON p.id = b.post_id
     WHERE b.anon_key = ? ORDER BY b.created_at DESC`
  ).all(anonKey);
  return Promise.all(rows.map(async (row) => rowToPost(row, { ...(await attachReactionAndPoll(row, anonKey)), bookmarked: true })));
}

// Everything this account has reacted to — a plain like or any emoji — most
// recent first. Each post carries myReaction, so the Likes tab shows exactly
// the emoji that was used. Batched: fixed number of queries per page.
export async function getLikedPosts(anonKey, { limit = 60, before = null } = {}) {
  const rows = await contentDb.prepare(
    `SELECT p.*, r.created_at AS reacted_at FROM likes r JOIN posts p ON p.id = r.post_id
     WHERE r.anon_key = ? AND p.visibility <> 'removed' ${before ? "AND r.created_at < ?" : ""} ORDER BY r.created_at DESC LIMIT ${Math.min(Number(limit) || 60, 100)}`
  ).all(...(before ? [anonKey, before] : [anonKey]));
  const extras = await attachBatchExtras(rows, anonKey);
  return rows.map((row, i) => ({ ...rowToPost(row, extras[i]), reactedAt: row.reacted_at }));
}

// ---------------- Sponsored Roasts (ads) ----------------

export async function getAds(geo) {
  const now = new Date().toISOString();
  const rows = await contentDb.prepare(
    `SELECT a.id, a.data FROM ads a LEFT JOIN advertisers v ON v.id = a.advertiser_id
     WHERE a.review_status = 'approved' AND (v.status IS NULL OR v.status = 'active')
       AND (a.starts_at IS NULL OR a.starts_at <= ?) AND (a.ends_at IS NULL OR a.ends_at >= ?)
       AND (a.total_budget_cents IS NULL OR (SELECT COUNT(*) FROM ad_events e WHERE e.ad_id = a.id AND e.kind = 'impression') * COALESCE(a.cpm_cents, 500) / 1000 < a.total_budget_cents)
     ORDER BY a.id`
  ).all(now, now);
  // Audience targeting (country / region / city) is applied here so every client gets the same answer.
  // The audience itself is stripped before sending: viewers don't need to see how they were targeted.
  const { adMatchesGeo } = await import("../geo.js");
  return rows
    .map((r) => ({ ...JSON.parse(r.data), id: r.id }))
    .filter((a) => geo === undefined || adMatchesGeo(a.geo, geo))
    .map(({ geo: _g, ...ad }) => ad);
}

// ---------------- Resume roast ----------------

export function getRoastLines() {
  return ROAST_LINES_SEED;
}


// Full per-emoji breakdown (capped) for the "see all reactions" sheet. The
// feed itself only ever carries the top few so a post with thousands of
// differently-reacted emojis stays light and tidy.
export async function getReactionBreakdown(kind, id) {
  const [table, col] = kind === "comment" ? ["comment_reactions", "comment_id"] : ["reactions", "post_id"];
  const rows = await contentDb.prepare(
    `SELECT reaction, COUNT(*) AS n FROM ${table} WHERE ${col} = ? GROUP BY reaction ORDER BY n DESC LIMIT 60`
  ).all(id);
  const all = rows.map((r) => [r.reaction, Number(r.n)]);
  return { total: all.reduce((a, b) => a + b[1], 0), kinds: all.length, all };
}
