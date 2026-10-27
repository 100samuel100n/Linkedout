// Repair script for cold-start content. Replaces every flat colour-block
// image on posts with a real photo (Pexels) — or, without a Pexels key, a
// unique generated artwork — and gives seeded accounts their own unique
// avatars. Idempotent: run it as often as you like.
//
// Why the earlier version "missed" posts: it read posts through getPosts(),
// which returns only the newest 40. This version queries the database
// directly, so it covers EVERY post, however old.
//
// A post image counts as a leftover placeholder when it's a plain .png
// (the old colour blocks). Real photos are .jpg, and generated artwork is
// stored under a key containing "-art-" so it is never mistaken for one.
//
// Usage:  node --env-file=.env.production.local scripts/reattach-post-images.js
import crypto from "node:crypto";
import { contentDb } from "../lib/content/db.js";
import { identityDb } from "../lib/identity/db.js";
import { attachMediaToPost } from "../lib/content/service.js";
import { fetchStockPhotoForPost, generatedArtForPost } from "./lib/stock-photos.js";
import { saveGeneratedMedia } from "../lib/media.js";
import { clearAvatarPath, ensureAvatarStyle } from "../lib/identity/service.js";
import { deleteAvatarFile } from "../lib/avatars.js";

const log = console.log;

async function repairPostImages() {
  await contentDb.ensureReady();
  const { rows } = await contentDb.pool.query(
    `SELECT id, type, tags FROM posts
     WHERE media_type = 'image' AND repost_of IS NULL
       AND (media_path ~* '\\.png(\\?.*)?$' AND media_path NOT LIKE '%-art-%')
     ORDER BY created_at DESC`
  );
  log(`Found ${rows.length} posts still showing a colour-block placeholder.`);

  let photos = 0, art = 0;
  for (const r of rows) {
    const post = { id: r.id, type: r.type, tags: JSON.parse(r.tags || "[]") };
    let buffer = await fetchStockPhotoForPost(post);
    let contentType = "image/jpeg";
    if (buffer) photos++;
    else { ({ buffer, contentType } = generatedArtForPost(post)); art++; }
    // A fresh object key each time, so browsers/CDNs never serve the old image.
    const tag = photos + art > 0 && contentType === "image/png" ? "art-" : "";
    const url = await saveGeneratedMedia(`${r.id}-${tag}${crypto.randomBytes(3).toString("hex")}`, buffer, contentType);
    await attachMediaToPost(r.id, "image", url);
  }
  log(`Posts: ${photos} now have a real photo, ${art} have unique generated artwork.`);
}

async function repairAvatars() {
  await identityDb.ensureReady();
  // Only seed-script accounts; never a real user's uploaded photo. The HQ
  // account keeps the brand mark.
  const { rows } = await identityDb.pool.query(
    "SELECT id, pseudonym, avatar_path FROM accounts WHERE email LIKE '%@linkedout.demo' AND pseudonym != 'linkedout_hq'"
  );
  for (const r of rows) {
    if (r.avatar_path) { await deleteAvatarFile(r.avatar_path); await clearAvatarPath(r.id); }
    await ensureAvatarStyle(r.id);
  }
  log(`Avatars: ${rows.length} seeded accounts now use their own unique generated avatar.`);
}

async function main() {
  if (!process.env.PEXELS_API_KEY) log("(No PEXELS_API_KEY — using unique generated artwork instead of photos.)");
  await repairPostImages();
  await repairAvatars();
  log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error("Repair script failed:", e); process.exit(1); });
