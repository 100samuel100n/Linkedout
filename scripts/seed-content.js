#!/usr/bin/env node
// The cold-start script. Every account here is a REAL account created
// through await createAccount() — the exact same function /api/auth/signup
// calls — and every post/company/job/room is created through the exact
// same await createPost()/await createCompany()/await createJob()/await createRoom() functions
// the real API routes call. Nothing here is a fake row injected directly
// into a table; it's the same code path a real signup + real posting
// session would take, run 20-some times in a row.
//
// This is the pattern documented in-chat earlier: Reddit's founders
// seeded the site by posting as different users before real activity
// existed, then phased the fake accounts out as real ones arrived. The
// credentials below are real, logged-in-able accounts — not a permanent
// deception, a genuine starting point. See SEED_ACCOUNTS.md for the
// login list this script writes out.
//
// Usage: node scripts/seed-content.js
import fs from "node:fs";
import path from "node:path";
import {
  createAccount, issueContentToken, verifyContentToken, getOrCreateAlias, setAvatarPath,
  getAccountByPseudonym, followHandle,
} from "../lib/identity/service.js";
import {
  createPost, createComment, toggleReaction, setRepost, votePoll, voteCringe,
  createCompany, addCompanyReview, addCompanySalary, addCompanyHorrorStory,
  createJob, createRoom, joinRoom, attachMediaToPost,
  getPosts, getCompanies, getJobs, getRooms,
} from "../lib/content/service.js";
import { saveGeneratedAvatar } from "../lib/avatars.js";
import { saveGeneratedMedia } from "../lib/media.js";
import { fetchStockPhotoForPost } from "./lib/stock-photos.js";
import { identityDb } from "../lib/identity/db.js";
import { contentDb } from "../lib/content/db.js";
import { generatedArtForPost } from "./lib/stock-photos.js";
import { seedFollows, seedTiers } from "./lib/social-graph.js";
import { seedEngagement } from "./lib/engagement.js";

const SEED_PASSWORD = "LinkedOut2026!";

const PERSONAS = [
  { realName: "Priya Malhotra", pseudonym: "priya_vents", country: "India", interests: ["Management", "Salary Transparency"] },
  { realName: "Marcus Webb", pseudonym: "marcus_ghosted", country: "United States", interests: ["Layoffs", "Interview Horror Stories"] },
  { realName: "Devon Reyes", pseudonym: "devon_parody", country: "United States", interests: ["Corporate Jargon"] },
  { realName: "Jordan Kim", pseudonym: "jordan_burnt_out", country: "South Korea", interests: ["Burnout"] },
  { realName: "Sam Okafor", pseudonym: "sam_quietquits", country: "Nigeria", interests: ["Burnout", "Remote Work"] },
  { realName: "Taylor Brooks", pseudonym: "taylor_wfh_or_die", country: "United Kingdom", interests: ["Remote Work"] },
  { realName: "Alex Chen", pseudonym: "alex_no_cap", country: "Canada", interests: ["Corporate Jargon", "Imposter Syndrome"] },
  { realName: "Morgan Ellis", pseudonym: "morgan_layoffsurvivor", country: "United States", interests: ["Layoffs"] },
  { realName: "Riley Foster", pseudonym: "riley_imposter", country: "Australia", interests: ["Imposter Syndrome"] },
  { realName: "Casey Nguyen", pseudonym: "casey_ratio", country: "Vietnam", interests: ["Corporate Jargon"] },
  { realName: "Jamie Ortiz", pseudonym: "jamie_underpaid", country: "Mexico", interests: ["Salary Transparency"] },
  { realName: "Drew Sullivan", pseudonym: "drew_quietfires", country: "Ireland", interests: ["Management"] },
  { realName: "Skyler Park", pseudonym: "skyler_toxicpositivity", country: "United States", interests: ["Corporate Jargon", "Burnout"] },
  { realName: "Reese Coleman", pseudonym: "reese_burnoutbarbie", country: "United States", interests: ["Burnout"] },
  { realName: "Avery Nakamura", pseudonym: "avery_9to5survivor", country: "Japan", interests: ["Career Pivots"] },
  { realName: "Quinn Torres", pseudonym: "quinn_recruiter_ghost", country: "Spain", interests: ["Interview Horror Stories"] },
  { realName: "Harper Diallo", pseudonym: "harper_manager_problems", country: "France", interests: ["Management"] },
  { realName: "Rowan Fischer", pseudonym: "rowan_freelance_free", country: "Germany", interests: ["Career Pivots", "Remote Work"] },
  { realName: "Emerson Blake", pseudonym: "emerson_startup_scars", country: "United States", interests: ["Startup Chaos"] },
  { realName: "Finley Osei", pseudonym: "finley_remote_rebel", country: "Ghana", interests: ["Remote Work"] },
  { realName: "LinkedOut Team", pseudonym: "linkedout_hq", country: "United States", accountType: "business", interests: [] },
];

function log(...args) { console.log(...args); }

// ---------------- Timestamp dispersion ----------------
// Every createXxx() call defaults to "now" if you don't pass createdAt —
// fine for real usage, but calling all of them back-to-back in this
// script used to leave every seeded post within seconds of each other.
// Worse than that: even the earlier version of this fix (random jitter
// spread across weeks) could still land two posts in the same relative-
// time *bucket* — formatRelativeTime() in lib/content/db.js rounds down
// to "Nh ago" / "Nd ago" / "Nw ago", so two posts nine minutes apart can
// both read "3h ago". That's the actual tell that gives away a cold
// start, not the raw timestamps. Fixed properly below: each cursor hands
// out a shuffled-free, strictly distinct sequence of bucket values (1h
// ago, 2h ago, 3h ago... never repeating one), weighted toward recent
// activity the way a real feed's history actually looks — a long tail
// of a few older posts, a cluster of very recent ones — rather than an
// unnaturally even smear across the whole window. Because
// formatRelativeTime() recomputes from the stored created_at against
// Date.now() on every read, labels keep advancing correctly in
// real time after deploy on their own — nothing to maintain there, and
// nothing about re-running this script later "resets" that; it just
// adds a fresh, equally-distinct batch of its own.
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

// Builds a pool of ms-ago offsets, strictly descending (oldest first),
// each guaranteed to fall in its own formatRelativeTime() bucket.
// `spanDays` caps how far back the oldest entries reach.
function buildDistinctOffsets(spanDays) {
  const offsets = [];
  if (spanDays >= 60) for (let mo = Math.min(11, Math.floor(spanDays / 30)); mo >= 2; mo--) offsets.push(mo * 30 * DAY_MS);
  if (spanDays >= 21) for (let w = Math.min(3, Math.floor(spanDays / 7)); w >= 1; w--) offsets.push(w * 7 * DAY_MS);
  for (let d = Math.min(6, spanDays); d >= 1; d--) offsets.push(d * DAY_MS);
  for (let h = 23; h >= 1; h--) offsets.push(h * HOUR_MS);
  for (let m = 59; m >= 5; m--) offsets.push(m * MIN_MS);
  return offsets; // strictly descending ms-ago, so index 0 = oldest
}

function makeTimeCursor(spanDays) {
  const offsets = buildDistinctOffsets(spanDays);
  let i = 0;
  return {
    // Ignores min/maxHours (kept as no-op params so call sites below
    // didn't all need editing) — the whole point is these are no longer
    // random.
    next() {
      // Defensive: if a content type somehow needs more distinct slots
      // than its span provides, keep going 1 extra hour further back
      // per overflow item rather than throwing or colliding.
      const offset = i < offsets.length ? offsets[i] : offsets[offsets.length - 1] + (i - offsets.length + 1) * HOUR_MS;
      i++;
      return new Date(Date.now() - offset).toISOString();
    },
  };
}

// For replies/reactions/reposts that should land sometime after the
// thing they're reacting to, not before it and not all at the same instant.
function timeAfter(baseIso, minHours, maxHours) {
  const t = new Date(baseIso).getTime() + (minHours + Math.random() * (maxHours - minHours)) * HOUR_MS;
  return new Date(Math.min(t, Date.now())).toISOString();
}

async function makeAccounts() {
  const accounts = [];
  for (const p of PERSONAS) {
    const email = `${p.pseudonym}@linkedout.demo`;
    try {
      const account = await createAccount({
        email, password: SEED_PASSWORD, realName: p.realName, pseudonym: p.pseudonym,
        country: p.country, accountType: p.accountType || "personal", interests: p.interests || [],
      });
      accounts.push(account);
      // The HQ account gets the real brand mark instead of a random
      // color — every other seeded persona gets a generated placeholder.
      if (p.pseudonym === "linkedout_hq" && fs.existsSync(path.join(process.cwd(), "public", "logo-mark.png"))) {
        await setAvatarPath(account.id, await saveGeneratedAvatar(account.id, fs.readFileSync(path.join(process.cwd(), "public", "logo-mark.png"))));
      }
      // Every other persona uses the account's own unique generated avatar
      // (assigned automatically at account creation — see lib/avatar-art.js),
      // so no two seeded accounts ever look alike.
      log(`  created ${account.pseudonym} <${email}>`);
    } catch (e) {
      if (e.code === "EMAIL_TAKEN" || e.code === "PSEUDONYM_TAKEN") {
        // This persona already exists from an earlier (possibly crashed
        // partway through) run — reuse the existing account rather than
        // just skipping it, so the returned roster is always COMPLETE.
        // Without this, a resumed run would silently work with a partial
        // persona list, breaking the positional pick(nonHq, i) lookups
        // every seedX() function below relies on, and specifically
        // leaving whichever content type runs later (companies, jobs,
        // rooms) referencing the wrong or missing accounts.
        const existing = await getAccountByPseudonym(p.pseudonym);
        if (existing) accounts.push(existing);
        log(`  reusing existing ${p.pseudonym} (already existed)`);
      } else {
        throw e;
      }
    }
  }
  return accounts;
}

async function postAs(account, { type, mood, text, tags = [], mode = "alias", title = null, category = null, pollOptions = null, eventAt = null, eventLocation = null, cringeNominated = false, createdAt = null }) {
  const { token } = await issueContentToken(account.id, mode);
  const identity = await verifyContentToken(token);
  return await createPost({
    type, mood, text, tags, title, category, pollOptions, eventAt, eventLocation, cringeNominated,
    authorDisplay: identity.displayLabel, anonymousId: identity.anonymousId,
    visibility: "public", createdAt,
  });
}

async function commentAs(account, postId, text, mode = "alias", createdAt = null) {
  const { token } = await issueContentToken(account.id, mode);
  const identity = await verifyContentToken(token);
  return await createComment({ postId, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel, text, createdAt });
}

async function repostAs(account, originalId, quoteText = null, mode = "alias", createdAt = null) {
  const { token } = await issueContentToken(account.id, mode);
  const identity = await verifyContentToken(token);
  const alias = await getOrCreateAlias(account.id);
  // Goes through setRepost so the one-repost-per-account rule holds for seed data too.
  const res = await setRepost({
    postId: originalId, anonKey: alias.anonymousId, on: true, quoteText,
    authorDisplay: identity.displayLabel, anonymousId: identity.anonymousId,
  });
  if (createdAt && res.created) {
    await contentDb.pool.query("UPDATE posts SET created_at = $1 WHERE repost_of = $2 AND anonymous_id = $3", [createdAt, originalId, identity.anonymousId]);
  }
  return res;
}

async function reactAs(account, postId, reaction) {
  const anonKey = (await getOrCreateAlias(account.id)).anonymousId;
  return await toggleReaction(postId, anonKey, reaction);
}

async function pollVoteAs(account, postId, optionIndex) {
  const anonKey = (await getOrCreateAlias(account.id)).anonymousId;
  return await votePoll(postId, anonKey, optionIndex);
}

async function cringeVoteAs(account, postId) {
  const anonKey = (await getOrCreateAlias(account.id)).anonymousId;
  return await voteCringe(postId, anonKey);
}

const RANTS = [
  "My manager just said 'let's take this offline' in a meeting that WAS already offline. We were in a conference room. There is no online to take it to.",
  "Got a calendar invite titled 'Quick Sync :)' for 90 minutes. The smiley face is doing a lot of unpaid emotional labor in that title.",
  "HR rebranded 'unlimited PTO' as 'flexible time off' in an email that also flagged me as 'trending under-utilized' on my PTO tracker. Cool cool cool.",
  "Asked my manager for feedback. Got 'just bring more energy to the team.' I have brought a laptop, three years of my life, and a mild ulcer.",
  "Someone in Slack said 'per my last message' and I felt my soul leave my body.",
  "New policy: submit a 'Weekly Wins' doc. I wrote 'survived' four weeks running before anyone said anything.",
  "My 1:1 got moved to 8am 'to respect my work-life balance.' The irony wrote itself so I didn't have to.",
  "Manager scheduled a 'quick chat' at 4:45pm on a Friday. If you know, you know. I do not have a job Monday.",
  "45-minute meeting to decide whether we needed a meeting about the meeting. We did not resolve this.",
  "Got told my communication style 'needs work,' zero examples given, in a meeting that itself needed serious communication work.",
  "'We're a family here' — said right before laying off 12 people over Zoom with cameras forced on.",
  "Someone scheduled a mandatory 7am 'energy huddle.' I have never had less energy in my life than at 7:01am today.",
  "Corporate sent a survey asking how we're 'feeling about culture.' The optional comment box has never seen so much restraint.",
  "My out-of-office says I'm 'recharging.' What I'm actually doing is lying on my apartment floor reconsidering every choice that led here.",
];

const CONFESSIONS = [
  "Three years into this job and I still don't fully know what my manager's manager does. I've stopped asking. It feels too late now.",
  "I have a folder called 'definitely not job searching' on my work laptop. It is, in fact, entirely job searching.",
  "I said 'happy to hop on a call' in an email while internally screaming. This is my life now.",
  "Nodded along in a meeting about 'synergizing our verticals' with zero idea what that meant. Still don't. Thriving.",
  "I've muted my camera and stared at the ceiling for entire meetings. 10/10 no regrets.",
  "Cried in my car in the parking garage before a performance review, then walked in and said I was 'excited to discuss growth opportunities.'",
  "I still Google 'what is a fiscal quarter' sometimes, three promotions in. I refuse to elaborate.",
  "Told my team I was 'deep in strategic work' for two hours. I was reorganizing my Spotify playlists.",
  "I have never once used the phrase 'circle back' unironically and yet I've said it in four meetings this week alone.",
  "Accidentally left my camera on during a 'quick stretch' that was actually me lying face-down on the floor. Nobody said anything. We do not speak of it.",
  "I've been 'wrapping up a few things' for the last 45 minutes of every workday for two years. The things do not exist.",
  "Someone asked what I actually do here. I laughed. Then I panicked because I didn't have an answer.",
];

const PARODIES = [
  { text: "Humbled to share I was let go today. This isn't an ending, it's a redirection. Grateful for the growth, the memories, and the badge that stopped working at the door. Open to opportunities in synergy-adjacent spaces. DM me!", cringe: true },
  { text: "Devastated to announce my 'restructuring journey' begins today. Thankful for the free snacks, the growth mindset, and the two weeks of severance. Onward and upward, as they say!", cringe: true },
  { text: "So grateful for this season of 'transition.' Nothing teaches resilience like finding out you're laid off via a Slack channel titled #farewell-friends.", cringe: true },
  { text: "Just wrapped an incredible quarter of 'quiet reflection' (unemployment). Excited for what's next (rent is due Friday).", cringe: true },
  { text: "Thrilled to share I've been 'right-sized' out of my role! Forever grateful for the opportunity to grow (anxious) and learn (that HR reads Slack DMs).", cringe: true },
  { text: "Posted a 9-slide carousel titled 'What My Toddler Taught Me About Q3 OKRs.' Closing slide: 'connect if this resonated.' It did not resonate. It was about a toddler.", cringe: true },
  { text: "Hot take: work-life balance is a mindset, not a policy. — posted at 11:47pm by someone whose calendar shows back-to-back meetings until 9pm.", cringe: true },
  { text: "Just hit 10 years at a company that has laid off 40% of my team twice. Loyalty is a mindset too, apparently.", cringe: false },
  { text: "'We don't have managers here, we have mentors!' said the mentor who just denied my PTO request via a strongly worded Slack thread.", cringe: false },
  { text: "Beyond blessed to announce my promotion to Senior Strategic Growth Lead — new title, zero raise, exact same responsibilities as before.", cringe: true },
  { text: "So inspired by my CEO's post about 'leading with vulnerability.' He laid off the vulnerability team an hour later.", cringe: true },
  { text: "Honored to be named a 'Culture Champion' at the same all-hands where they announced return-to-office five days a week, no exceptions.", cringe: false },
];

const QUESTIONS = [
  "Is it normal that my manager only communicates in GIFs? Asking for a coworker who has seen things.",
  "Genuine question: has anyone negotiated severance without a lawyer, or is that a myth we tell ourselves?",
  "Why does every job posting want '5+ years experience' for a tool that's been out for 2 years? Who are these candidates?",
  "Is quiet quitting just... having boundaries? Genuinely asking, because HR seems to think it's a crime.",
  "Is it worth taking a counteroffer, or is that just delaying the inevitable exit?",
  "Anyone else's manager schedule 1:1s and then spend the whole time on their phone? Just me?",
];

const EVENTS = [
  { text: "AMA: I negotiated my way out of a toxic job without burning a single bridge. Ask me anything.", eventLocation: "LinkedOut Vent Sessions", daysOut: 3 },
  { text: "Virtual Meetup: Freelancers Who Escaped the 9-to-5 (bring your own coffee, we don't do catering here).", eventLocation: "Virtual — link in comments", daysOut: 5 },
  { text: "LinkedOut Town Hall: What Would You Add to This App? (yes we're asking, yes we mean it).", eventLocation: "Virtual", daysOut: 7 },
];

const POLLS = [
  { text: "Which excuse got you out of a meeting today?", options: ["My dog is having a medical emergency (dog is fine)", "I'm losing you — bad connection (perfect wifi)", "Just didn't join, said calendar was wrong"] },
  { text: "How did you find out about your last layoff?", options: ["Calendar invite", "Slack message", "Badge stopped working", "Read it on a career feed before HR told me"] },
  { text: "What's the most unhinged thing HR has said to you?", options: ["We're like a family", "It's about culture fit", "Wear many hats", "This is a growth opportunity"] },
  { text: "Best excuse to leave a meeting early?", options: ["Another meeting", "Bathroom", "Dog", "I simply left"] },
  { text: "How many unread Slack channels do you have right now?", options: ["0-10", "11-30", "31-100", "I have stopped counting"] },
];

const HQ_POSTS = [
  "Welcome to LinkedOut. We built this because polished career feeds told us to be grateful for opportunities that laid us off. This is the place for the truth instead.",
  "Quick note from the team: reactions are now real. You can only react once per post per account, no more inflating your own posts at 2am. We see you. We stopped you.",
  "Cringe Awards nominations are open — tag your most unhinged corporate-style parody post and let the people vote.",
];

async function seedPosts(accounts) {
  const nonHq = accounts.filter((a) => a.pseudonym !== "linkedout_hq");
  const hq = accounts.find((a) => a.pseudonym === "linkedout_hq");
  const moods = ["Barely Holding On", "Job Hunting in Silence", "Thriving (Lying)", "Imposter Syndrome, Party of One", "Chaotic Neutral"];
  const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];
  const allPosts = [];

  // Posts accumulate oldest-first over ~5 weeks; the HQ welcome/announce
  // posts land wherever their position in the timeline naturally falls,
  // same as any other account's posts would.
  const postClock = makeTimeCursor(35);

  for (const [i, text] of RANTS.entries()) allPosts.push(await postAs(pick(nonHq, i), { type: "rant", mood: pick(moods, i), text, tags: ["Rant"], createdAt: postClock.next() }));
  for (const [i, text] of CONFESSIONS.entries()) allPosts.push(await postAs(pick(nonHq, i + 3), { type: "confession", mood: pick(moods, i + 1), text, tags: ["Confession"], createdAt: postClock.next() }));
  for (const [i, p] of PARODIES.entries()) allPosts.push(await postAs(pick(nonHq, i + 7), { type: "parody", mood: pick(moods, i + 2), text: p.text, tags: ["Parody"], cringeNominated: p.cringe, createdAt: postClock.next() }));
  for (const [i, text] of QUESTIONS.entries()) allPosts.push(await postAs(pick(nonHq, i + 11), { type: "question", mood: pick(moods, i), text, tags: ["Question"], createdAt: postClock.next() }));
  for (const [i, e] of EVENTS.entries()) {
    allPosts.push(await postAs(pick(nonHq, i + 5), {
      type: "event", mood: "Chaotic Neutral", text: e.text, tags: ["Event"],
      eventAt: new Date(Date.now() + e.daysOut * 24 * 60 * 60 * 1000).toISOString(), eventLocation: e.eventLocation,
      createdAt: postClock.next(),
    }));
  }
  for (const [i, p] of POLLS.entries()) allPosts.push(await postAs(pick(nonHq, i + 2), { type: "poll", mood: "Chaotic Neutral", text: p.text, tags: ["Poll"], pollOptions: p.options, createdAt: postClock.next() }));
  for (const text of HQ_POSTS) allPosts.push(await postAs(hq, { type: "rant", mood: "Chaotic Neutral", text, tags: ["LinkedOut HQ"], createdAt: postClock.next(6, 30) }));

  log(`  created ${allPosts.length} posts`);

  // A third of posts get a real, topic-relevant photo attached (via
  // Pexels — see scripts/lib/stock-photos.js), falling back to a solid
  // color block only if PEXELS_API_KEY isn't configured or a fetch
  // fails. This app's feed used to be 100% bare text on a fresh seed,
  // which read as an obvious cold start on its own regardless of
  // timestamps. Real deployments will naturally accumulate a mix of
  // text/media posts; this gives a freshly-seeded database that same
  // mixed look immediately.
  let mediaCount = 0;
  let realPhotoCount = 0;
  for (const [i, post] of allPosts.entries()) {
    if (post.type === "poll" || post.type === "event" || i % 3 !== 0) continue;
    let buffer = await fetchStockPhotoForPost(post);
    let contentType = "image/jpeg";
    if (buffer) {
      realPhotoCount++;
    } else {
      // Never a flat colour block: a unique generated artwork per post.
      ({ buffer, contentType } = generatedArtForPost(post));
    }
    const url = await saveGeneratedMedia(contentType === "image/png" ? `${post.id}-art-seed` : post.id, buffer, contentType);
    await attachMediaToPost(post.id, "image", url);
    mediaCount++;
  }
  log(`  attached ${mediaCount} images (${realPhotoCount} real photos, ${mediaCount - realPhotoCount} generated artworks)`);

  const parodyPosts = allPosts.filter((p) => p.type === "parody");
  let repostCount = 0, commentCount = 0, reactionCount = 0, pollVoteCount = 0, cringeVoteCount = 0;
  for (const [i, post] of parodyPosts.slice(0, 6).entries()) {
    await repostAs(pick(nonHq, i + 4), post.id, i % 2 === 0 ? "This is too real." : null, "alias", timeAfter(post.createdAt, 1, 96));
    repostCount++;
  }
  for (const [i, post] of allPosts.slice(0, 20).entries()) {
    await commentAs(pick(nonHq, i + 6), post.id, pick([
      "This is way too accurate.", "I felt this in my soul.", "Screenshotting this for my next 1:1.",
      "Not me reading this during a meeting right now.", "This is a callout post and I felt seen.",
    ], i), "alias", timeAfter(post.createdAt, 0.2, 48));
    commentCount++;
  }
  for (const [i, post] of allPosts.entries()) {
    await reactAs(pick(nonHq, i + 8), post.id, pick(["😩", "😂", "💀", "🚩"], i));
    reactionCount++;
  }
  const pollPosts = allPosts.filter((p) => p.type === "poll");
  for (const [i, poll] of pollPosts.entries()) {
    for (let v = 0; v < 5; v++) { await pollVoteAs(pick(nonHq, i + v), poll.id, v % poll.pollOptions.length); pollVoteCount++; }
  }
  for (const [i, post] of parodyPosts.filter((p) => p.cringeNominated).entries()) {
    for (let v = 0; v < 6; v++) { await cringeVoteAs(pick(nonHq, i + v + 3), post.id); cringeVoteCount++; }
  }

  log(`  + ${repostCount} reposts, ${commentCount} comments, ${reactionCount} reactions, ${pollVoteCount} poll votes, ${cringeVoteCount} cringe votes`);
  return allPosts;
}

const COMPANIES = [
  {
    name: "Meridian Holdings", industry: "Fintech", description: "1,200 employees.",
    reviews: [["red", "Ghosts candidates"], ["red", "Toxic manager (specific team)"], ["green", "Great pay"], ["red", "No work/life boundaries"], ["red", "Seven interview rounds"]],
    salaries: [118000, 142000, 164000, 129000], horror: "Seven interview rounds, take-home assignment they never opened, then radio silence for 11 weeks. Found out the role was reposted — same JD, new req number.",
  },
  {
    name: "Northwind Analytics", industry: "Data / SaaS", description: "340 employees.",
    reviews: [["green", "Great WLB"], ["green", "Actually pays for therapy"], ["red", "Slow promo cycle"]],
    salaries: [95000, 118000, 141000], horror: "One bad manager on the data team, everyone knows which one. HR actually did something eventually, which was a plot twist.",
  },
  {
    name: "Halcyon Group", industry: "Consulting", description: "5,600 employees.",
    reviews: [["red", "Layoffs via mass calendar invite"], ["red", "Unpaid overtime culture"], ["green", "Free snacks"], ["red", "Badge deactivated before the meeting"]],
    salaries: [130000, 175000, 210000], horror: "Found out I was laid off because my badge stopped working at the door. Security walked me to a folding table to collect my laptop.",
  },
  {
    name: "Vertex Dynamics", industry: "Enterprise Software", description: "890 employees.",
    reviews: [["red", "Underpays relative to market"], ["red", "Overworks juniors"], ["green", "Good benefits"]],
    salaries: [88000, 96000, 102000], horror: "Offered a 3% raise after a promotion that came with two more direct reports and a new title nobody explained.",
  },
  {
    name: "Bright Horizon Media", industry: "Media / Advertising", description: "410 employees.",
    reviews: [["red", "Unpaid overtime culture"], ["red", "Chaotic leadership"], ["green", "Creative freedom"]],
    salaries: [72000, 85000], horror: "Was told 'we're all wearing many hats right now' during a redundancy announcement for the fourth quarter in a row.",
  },
  {
    name: "Ferrous Capital", industry: "Finance", description: "2,100 employees.",
    reviews: [["green", "Pays extremely well"], ["red", "Brutal hours"], ["red", "No boundaries after 6pm"]],
    salaries: [145000, 190000, 230000], horror: "Got a Slack message at 11:40pm asking if I was 'still online' with no other context. I was not, in fact, still online. I got another message.",
  },
  {
    name: "CloudPeak Systems", industry: "Cloud Infrastructure", description: "560 employees.",
    reviews: [["green", "Genuinely remote-friendly"], ["green", "Reasonable on-call rotation"], ["red", "Promotions take forever"]],
    salaries: [110000, 132000, 150000], horror: "Nothing dramatic, honestly — just a slow promo cycle and a manager who forgets 1:1s exist. Mid, not evil.",
  },
];

async function seedCompanies(accounts) {
  const nonHq = accounts.filter((a) => a.pseudonym !== "linkedout_hq");
  const created = [];
  const companyClock = makeTimeCursor(50); // companies predate most posts
  for (const [i, c] of COMPANIES.entries()) {
    const founder = nonHq[i % nonHq.length];
    const { token } = await issueContentToken(founder.id, "alias");
    const identity = await verifyContentToken(token);
    const companyCreatedAt = companyClock.next(12, 72);
    const company = await createCompany({ name: c.name, industry: c.industry, description: c.description, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel, createdAt: companyCreatedAt });

    for (const [j, [flagType, tagText]] of c.reviews.entries()) {
      const reviewer = nonHq[(i + j + 1) % nonHq.length];
      const { token: rt } = await issueContentToken(reviewer.id, "alias");
      const rIdentity = await verifyContentToken(rt);
      await addCompanyReview({ companyId: company.id, anonymousId: rIdentity.anonymousId, authorDisplay: rIdentity.displayLabel, flagType, tagText, createdAt: timeAfter(companyCreatedAt, 2, 30 * 24) });
    }

    for (const [j, amount] of c.salaries.entries()) {
      const submitter = nonHq[(i + j + 2) % nonHq.length];
      const { token: st } = await issueContentToken(submitter.id, "anon");
      const sIdentity = await verifyContentToken(st);
      await addCompanySalary({ companyId: company.id, anonymousId: sIdentity.anonymousId, amount, createdAt: timeAfter(companyCreatedAt, 2, 30 * 24) });
    }

    const storyteller = nonHq[(i + 5) % nonHq.length];
    const { token: ht } = await issueContentToken(storyteller.id, "alias");
    const hIdentity = await verifyContentToken(ht);
    await addCompanyHorrorStory({ companyId: company.id, anonymousId: hIdentity.anonymousId, authorDisplay: hIdentity.displayLabel, story: c.horror, createdAt: timeAfter(companyCreatedAt, 2, 30 * 24) });

    created.push(company);
  }
  log(`  created ${created.length} companies with reviews, salaries, and horror stories`);
  return created;
}

const JOBS = [
  { title: "Senior Product Designer", companyName: "Northwind Analytics", salaryMin: 132000, salaryMax: 158000, reason: "Burnt out after covering two roles for 8 months post-layoffs. We fixed that — hence this req." },
  { title: "Growth Marketing Manager", companyName: "Halcyon Group", salaryMin: null, salaryMax: null, reason: null },
  { title: "Backend Engineer, Payments", companyName: "Meridian Holdings", salaryMin: 140000, salaryMax: 175000, reason: "Got a better offer with an actual title match. No drama, just a raise elsewhere." },
  { title: "DevOps Engineer", companyName: "CloudPeak Systems", salaryMin: 118000, salaryMax: 145000, reason: "Moved into management on the same team, still around if you have questions." },
  { title: "Account Executive", companyName: "Bright Horizon Media", salaryMin: null, salaryMax: null, reason: "Quota kept increasing without commission structure changes." },
];

async function seedJobs(accounts) {
  const nonHq = accounts.filter((a) => a.pseudonym !== "linkedout_hq");
  const jobClock = makeTimeCursor(21);
  for (const [i, j] of JOBS.entries()) {
    const poster = nonHq[i % nonHq.length];
    const { token } = await issueContentToken(poster.id, "alias");
    const identity = await verifyContentToken(token);
    await createJob({
      title: j.title, companyName: j.companyName, salaryMin: j.salaryMin, salaryMax: j.salaryMax,
      lastPersonQuitReason: j.reason, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel,
      createdAt: jobClock.next(12, 48),
    });
  }
  log(`  created ${JOBS.length} jobs`);
}

const ROOMS = [
  { topic: "Just Got Laid Off", vibe: "Support", joiners: 5 },
  { topic: "Startup Chaos Hour", vibe: "Vent", joiners: 3 },
  { topic: "Imposter Syndrome Anonymous", vibe: "Support", joiners: 6 },
  { topic: "Interview Horror Stories, Live", vibe: "Comedy", joiners: 4 },
  { topic: "Quiet Quitting Confessions", vibe: "Vent", joiners: 2 },
  { topic: "Freelance Survival Tips", vibe: "Support", joiners: 3 },
];

async function seedRooms(accounts) {
  const nonHq = accounts.filter((a) => a.pseudonym !== "linkedout_hq");
  const roomClock = makeTimeCursor(10);
  for (const [i, r] of ROOMS.entries()) {
    const founder = nonHq[i % nonHq.length];
    const { token } = await issueContentToken(founder.id, "alias");
    const identity = await verifyContentToken(token);
    const room = await createRoom({ topic: r.topic, vibe: r.vibe, anonymousId: identity.anonymousId, authorDisplay: identity.displayLabel, createdAt: roomClock.next(6, 30) });
    for (let j = 0; j < r.joiners; j++) {
      const joiner = nonHq[(i + j + 1) % nonHq.length];
      await joinRoom(room.id, (await getOrCreateAlias(joiner.id)).anonymousId);
    }
  }
  log(`  created ${ROOMS.length} rooms with real joins`);
}

function writeCredentialsFile(accounts) {
  const lines = [
    "# Seed Account Credentials",
    "",
    "These are REAL accounts created by scripts/seed-content.js through the",
    "same await createAccount() path a real signup uses — not fake data. Every",
    "post, company, job, and room in a freshly-seeded database is",
    "attributed to one of these, the same way Reddit's founders seeded",
    "activity under real (if founder-controlled) accounts early on.",
    "",
    "**Shared password for all of them:** `" + SEED_PASSWORD + "`",
    "",
    "Log in as any of these at `/login` to see the app from that account's",
    "point of view (their own posts, notifications, etc.). Rotate or delete",
    "these before using this database for anything beyond local demo/dev —",
    "a shared, published password is fine for seed content, not for",
    "anything meant to stay private.",
    "",
    "| Pseudonym | Real name | Email |",
    "|---|---|---|",
    ...accounts.map((a) => `| ${a.pseudonym} | ${a.realName} | ${a.email} |`),
  ];
  const outPath = path.join(process.cwd(), "SEED_ACCOUNTS.md");
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  log(`\nWrote credentials for ${accounts.length} accounts to ${outPath}`);
}

async function main() {
  log("Creating accounts...");
  const accounts = await makeAccounts();
  if (accounts.length === 0) {
    log("No accounts available (unexpected) — exiting without creating content.");
    return;
  }

  // Each content type is checked and skipped independently, rather than
  // one all-or-nothing guard on `accounts.length` — a run that crashed
  // partway through (e.g. mid-posts, before ever reaching companies)
  // needs to be able to pick up wherever it left off on a retry, without
  // re-creating (and duplicating) whatever already succeeded.
  if ((await getPosts()).length > 0) {
    log("\nPosts already exist — skipping post seeding.");
  } else {
    log("\nCreating posts...");
    await seedPosts(accounts);
  }

  if ((await getCompanies()).length > 0) {
    log("\nCompanies already exist — skipping company seeding.");
  } else {
    log("\nCreating companies...");
    await seedCompanies(accounts);
  }

  if ((await getJobs()).length > 0) {
    log("\nJobs already exist — skipping job seeding.");
  } else {
    log("\nCreating jobs...");
    await seedJobs(accounts);
  }

  if ((await getRooms()).length > 0) {
    log("\nRooms already exist — skipping room seeding.");
  } else {
    log("\nCreating rooms...");
    await seedRooms(accounts);
  }

  log("\nAssigning plans...");
  await seedTiers(accounts, log);

  // Tops up per account every run, so re-running never leaves zeros behind.
  log("\nBuilding the social graph...");
  await seedFollows(accounts, log);

  // Likes, emoji reactions, comments, saves, reposts and votes — tops up every
  // run, so an already-seeded database gains engagement without duplicates.
  log("\nSeeding engagement...");
  await seedEngagement(accounts, log);

  writeCredentialsFile(accounts);
  log("\nDone.");
}

main().catch((e) => {
  console.error("Seed script failed:", e);
  process.exit(1);
});
