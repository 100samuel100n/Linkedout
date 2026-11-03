// Generated avatars and post art. Every account gets a UNIQUE style key
// (pattern x hue pair x generation) recorded in accounts.avatar_style with
// a UNIQUE index, so no two accounts can ever share an avatar — the
// database enforces it, not just the hash. The picture itself is a pure
// function of the key (see renderAvatarPng), served by
// /api/avatars/g/[key], so there is nothing to store in the bucket and
// nothing in the URL that points back to an account.
//
// Key format:  p07-a12-b03-v0
//   p = pattern (0-15)   a = base hue step (0-23, 15deg each)
//   b = partner hue offset step (1-8)   v = variant generation (0+)
import crypto from "node:crypto";
import { encodePng } from "./png.js";

export const PATTERN_COUNT = 16;
export const HUE_STEPS = 24;
const KEY_RE = /^p(\d{2})-a(\d{2})-b(\d{2})-v(\d{1,3})$/;

export function makeKey({ p, a, b, v }) {
  return `p${String(p).padStart(2, "0")}-a${String(a).padStart(2, "0")}-b${String(b).padStart(2, "0")}-v${v}`;
}

export function parseKey(key) {
  const m = KEY_RE.exec(String(key || ""));
  if (!m) return null;
  const s = { p: +m[1], a: +m[2], b: +m[3], v: +m[4] };
  if (s.p >= PATTERN_COUNT || s.a >= HUE_STEPS || s.b < 1 || s.b > 12) return null;
  return s;
}

// Deterministic shuffle of every (pattern, hue) pair for one generation, so
// the first 384 accounts all differ in BOTH pattern and colour, and later
// generations differ in the partner hue / variant. `seed` only decides the
// walk order; uniqueness comes from the DB index.
export function candidateKeys(seed, generation) {
  const b = 1 + (generation % 8);
  const v = Math.floor(generation / 8);
  const pairs = [];
  for (let p = 0; p < PATTERN_COUNT; p++) for (let a = 0; a < HUE_STEPS; a++) pairs.push({ p, a });
  let h = crypto.createHash("sha256").update(String(seed) + ":" + generation).digest();
  let idx = 0;
  for (let i = pairs.length - 1; i > 0; i--) {
    if (idx + 2 > h.length) { h = crypto.createHash("sha256").update(h).digest(); idx = 0; }
    const j = ((h[idx] << 8) | h[idx + 1]) % (i + 1);
    idx += 2;
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs.map(({ p, a }) => makeKey({ p, a, b, v }));
}

// ---- colour ----
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const tri = (x) => Math.abs(((x % 1) + 1) % 1 * 2 - 1);

// Each pattern maps (u,v) in [-1,1] to a value t in [0,1] (position along
// the two-colour ramp) and may return a third value for an accent.
const PATTERNS = [
  (u, v) => clamp01((u + v) / 2 + 0.5),                                       // 0 diagonal gradient
  (u, v) => clamp01(Math.hypot(u, v)),                                        // 1 radial
  (u, v) => tri(Math.hypot(u, v) * 2.4),                                      // 2 rings
  (u, v) => (Math.floor((u + v) * 3.2 + 8) % 2 ? 0.92 : 0.08),               // 3 diagonal stripes
  (u, v) => ((Math.floor(u * 2.5 + 5) + Math.floor(v * 2.5 + 5)) % 2 ? 0.9 : 0.1), // 4 checker
  (u, v) => 0.5 + 0.5 * Math.sin(v * 4 + Math.sin(u * 3) * 1.6),              // 5 waves
  (u, v) => tri(Math.atan2(v, u) / Math.PI * 3),                              // 6 sunburst
  (u, v) => (Math.hypot(((u * 2.2 + 8) % 1) - 0.5, ((v * 2.2 + 8) % 1) - 0.5) < 0.28 ? 0.92 : 0.12), // 7 dot grid
  (u, v) => tri(Math.max(Math.abs(u), Math.abs(v)) * 2.2),                    // 8 concentric squares
  (u, v) => tri((Math.abs(u) + Math.abs(v)) * 2.2),                           // 9 diamonds
  (u, v) => tri(Math.atan2(v, u) / (2 * Math.PI) + Math.hypot(u, v) * 1.6),   // 10 spiral
  (u, v) => clamp01(0.9 * Math.exp(-((u - 0.4) ** 2 + (v + 0.3) ** 2) * 3) + 0.8 * Math.exp(-((u + 0.5) ** 2 + (v - 0.35) ** 2) * 4) + 0.15), // 11 blobs
  (u, v) => (v > 0 ? (Math.hypot(u, v) < 0.75 ? 0.9 : 0.35) : 0.1 + 0.2 * (u + 1)), // 12 half moon
  (u, v) => tri(v * 2.4 + tri(u * 2.2) * 0.9),                                // 13 zigzag
  (u, v) => (Math.abs(u) < 0.16 || Math.abs(v) < 0.16 ? 0.92 : 0.15 + 0.2 * Math.hypot(u, v)), // 14 cross
  (u, v) => clamp01(0.5 + 0.5 * Math.sin(Math.hypot(u + 0.6, v - 0.6) * 9) * (1 - Math.hypot(u, v) * 0.4)), // 15 arcs
];

export function renderRgb(key, width = 256, height = width) {
  const s = parseKey(key);
  if (!s) throw new Error("Invalid avatar key");
  const hueA = s.a * 15 + s.v * 5;
  const hueB = hueA + s.b * 27;
  const c1 = hsl(hueA, 72, 46);
  const c2 = hsl(hueB, 78, 68);
  const c0 = hsl(hueA + 180, 40, 14); // deep shade for contrast
  const fn = PATTERNS[s.p];
  const out = Buffer.alloc(width * height * 3);
  const SS = 2; // 2x2 supersampling keeps edges clean
  const scale = Math.max(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((x + (sx + 0.5) / SS) - width / 2) / (scale / 2);
        const v = ((y + (sy + 0.5) / SS) - height / 2) / (scale / 2);
        const t = clamp01(fn(u, v));
        const col = mix(mix(c0, c1, clamp01(t * 1.6)), c2, clamp01((t - 0.35) * 1.6));
        r += col[0]; g += col[1]; b += col[2];
      }
      const i = (y * width + x) * 3;
      out[i] = r / (SS * SS); out[i + 1] = g / (SS * SS); out[i + 2] = b / (SS * SS);
    }
  }
  return out;
}

export function renderPng(key, width = 256, height = width) {
  return encodePng(width, height, renderRgb(key, width, height));
}

export function avatarUrlForKey(key, appUrl) {
  return `${appUrl.replace(/\/$/, "")}/api/avatars/g/${key}.png`;
}
