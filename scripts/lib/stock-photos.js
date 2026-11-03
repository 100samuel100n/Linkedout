// Real, topic-relevant photos for seeded post media, via the Pexels API
// (free tier — get a key at pexels.com/api, no cost, no card required).
// Falls back to the old solid-color block (see placeholder-avatar.js) if
// PEXELS_API_KEY isn't set or a fetch fails, so the seed script never
// hard-depends on this — it just looks better when it's configured.
//
// Deliberately NOT used for avatars — a flat color square already reads
// correctly as a normal "no photo" avatar (Slack/Discord do the same
// thing), and giving every seeded persona a random stock-photo "face"
// would misrepresent them as if they were real, identifiable people,
// which cuts against this app's whole anonymous/pseudonymous premise.
// Post attachments are different: they're illustrating a topic, not
// standing in for a specific person.
import { renderPng, candidateKeys } from "../../lib/avatar-art.js";

const PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search";
let warnedNoKey = false;

// Photos already used in this run — no two posts get the same picture.
const usedPhotoIds = new Set();
const usedArtKeys = new Set();

// Unique generated artwork (never a flat colour) for when there's no photo.
export function generatedArtForPost(post, width = 800, height = 450) {
  let key = null;
  for (let gen = 0; gen < 50 && !key; gen++) {
    key = candidateKeys(post.id || String(Math.random()), gen).find((k) => !usedArtKeys.has(k)) || null;
  }
  usedArtKeys.add(key);
  return { buffer: renderPng(key, width, height), contentType: "image/png", key };
}

// Maps each post category/tag to a search query that reads as a
// plausible "someone attached a stock photo to this post" image, not a
// literal illustration of the post's specific joke.
const QUERY_BY_TAG = {
  Rant: ["frustrated office worker", "stressed at desk", "office meeting tension"],
  Confession: ["person thinking window office", "quiet office alone", "late night laptop work"],
  Parody: ["corporate handshake stock photo", "business meeting smiling", "office high five"],
  Question: ["question mark office", "confused coworkers", "team discussion whiteboard"],
  Event: ["networking event conference", "professional meetup crowd", "conference hall people"],
  Poll: ["hands raised meeting", "voting hands up", "team decision discussion"],
  "LinkedOut HQ": ["modern office building exterior", "tech office interior", "startup office space"],
};
const DEFAULT_QUERIES = ["modern office interior", "coworkers meeting", "laptop coffee desk"];

function queriesForPost(post) {
  const tag = (post.tags && post.tags[0]) || null;
  return (tag && QUERY_BY_TAG[tag]) || DEFAULT_QUERIES;
}

// Picks a random query for variety across posts sharing the same tag,
// then a random result within that query's results, so a batch of
// "Rant"-tagged posts don't all get the identical photo.
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Returns a JPEG Buffer, or null if unavailable (missing key, network
// error, no results) — caller is expected to fall back to
// solidColorPng() in that case.
export async function fetchStockPhotoForPost(post) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    if (!warnedNoKey) {
      console.log("  (PEXELS_API_KEY not set — using unique generated artwork instead of photos. See .env.local.example.)");
      warnedNoKey = true;
    }
    return null;
  }

  const query = pick(queriesForPost(post));
  try {
    const res = await fetch(`${PEXELS_SEARCH_URL}?query=${encodeURIComponent(query)}&per_page=40&page=${1 + Math.floor(Math.random() * 3)}&orientation=landscape`, {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) {
      console.log(`  (Pexels search failed for "${query}": HTTP ${res.status} — falling back to a placeholder.)`);
      return null;
    }
    const data = await res.json();
    if (!data.photos || data.photos.length === 0) return null;

    const fresh = data.photos.filter((p) => !usedPhotoIds.has(p.id));
    if (fresh.length === 0) return null;
    const photo = pick(fresh);
    usedPhotoIds.add(photo.id);
    const imgRes = await fetch(photo.src.large);
    if (!imgRes.ok) return null;
    const arrayBuffer = await imgRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    console.log(`  (Pexels fetch errored for "${query}": ${e.message} — falling back to a placeholder.)`);
    return null;
  }
}
