"use client";
// Web sound engine: every sound is synthesized with the Web Audio API (no
// audio files to load). Preferences live in localStorage for instant use
// and are mirrored to the server (/api/sound-preferences) so the same
// choices follow the account to other devices and decide the push tone.
//
// Browsers only allow audio after a user gesture, so the context is created
// lazily and unlocked on the first interaction; before that play is a no-op.
import { DEFAULT_SOUND_PREFS, normalizeSoundPrefs, TONES } from "./sound-tones.js";

let ctx = null;
let prefs = null;
const KEY = "lo-sound-prefs";
const listeners = new Set();

function load() {
  if (prefs) return prefs;
  try { prefs = normalizeSoundPrefs(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { prefs = { ...DEFAULT_SOUND_PREFS }; }
  return prefs;
}
export function getSoundPrefs() { return load(); }
export function subscribeSoundPrefs(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function updateSoundPrefs(changes, { sync = true } = {}) {
  prefs = normalizeSoundPrefs({ ...load(), ...changes });
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  listeners.forEach((f) => f(prefs));
  if (sync) {
    fetch("/api/sound-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs), credentials: "same-origin" }).catch(() => {});
  }
  return prefs;
}
// Called after login: adopt the account's saved preferences.
export async function pullSoundPrefs() {
  try {
    const res = await fetch("/api/sound-preferences", { credentials: "same-origin" });
    if (res.ok) updateSoundPrefs(await res.json(), { sync: false });
  } catch { /* offline — keep local */ }
}

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx.state === "running" ? ctx : null;
}
if (typeof window !== "undefined") {
  const unlock = () => { getCtx(); };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// One oscillator "note" with an amplitude envelope, into a shared output.
function note(c, out, { f, at = 0, dur = 0.3, type = "sine", gain = 0.3, decay = 6, glideTo = null, partials = null }) {
  const t0 = c.currentTime + at;
  const layers = partials || [[1, 1]];
  for (const [mult, amp] of layers) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f * mult, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo * mult, t0 + dur * 0.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain * amp, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.05, dur));
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

// Tone recipes mirror the bundled phone sounds closely enough to be the
// "same" tone on every platform.
const TONE_FN = {
  signal: (c, o) => { note(c, o, { f: 880, dur: 0.35 }); note(c, o, { f: 1318.5, at: 0.13, dur: 0.6 }); },
  glass: (c, o) => { const p = [[1, 1], [2.76, 0.5], [5.4, 0.25]]; note(c, o, { f: 1567, dur: 1, decay: 4, partials: p, gain: 0.2 }); note(c, o, { f: 2093, at: 0.16, dur: 1.1, partials: p, gain: 0.2 }); },
  bubble: (c, o) => { note(c, o, { f: 380, glideTo: 950, dur: 0.22 }); note(c, o, { f: 480, glideTo: 1250, at: 0.13, dur: 0.26 }); },
  pluck: (c, o) => { note(c, o, { f: 440, dur: 0.6, type: "triangle", partials: [[1, 1], [2, 0.4], [3, 0.2]] }); note(c, o, { f: 659.25, at: 0.12, dur: 0.8, type: "triangle", partials: [[1, 1], [2, 0.4], [3, 0.2]] }); },
  marimba: (c, o) => { const p = [[1, 1], [4, 0.35]]; note(c, o, { f: 523.25, dur: 0.45, partials: p }); note(c, o, { f: 659.25, at: 0.1, dur: 0.45, partials: p }); note(c, o, { f: 783.99, at: 0.2, dur: 0.7, partials: p }); },
  bell: (c, o) => { note(c, o, { f: 659.25, dur: 1.5, partials: [[1, 1], [2.4, 0.5], [3.5, 0.35], [5.1, 0.15]], gain: 0.22 }); },
  drop: (c, o) => { note(c, o, { f: 1300, glideTo: 420, dur: 0.3 }); },
  radar: (c, o) => { note(c, o, { f: 987.77, dur: 0.55, partials: [[1, 1], [2, 0.2]] }); note(c, o, { f: 987.77, at: 0.32, dur: 0.55, gain: 0.18, partials: [[1, 1], [2, 0.2]] }); },
  soft: (c, o) => { note(c, o, { f: 392, dur: 0.9, partials: [[1, 1], [2, 0.3]], gain: 0.25 }); note(c, o, { f: 523.25, at: 0.18, dur: 1, partials: [[1, 1], [2, 0.3]], gain: 0.25 }); },
};
const CUE_FN = {
  join: (c, o) => { note(c, o, { f: 523.25, dur: 0.22, gain: 0.22 }); note(c, o, { f: 783.99, at: 0.09, dur: 0.35, gain: 0.22 }); },
  leave: (c, o) => { note(c, o, { f: 659.25, dur: 0.22, gain: 0.2 }); note(c, o, { f: 440, at: 0.09, dur: 0.35, gain: 0.2 }); },
  ended: (c, o) => { note(c, o, { f: 523.25, dur: 0.35 }); note(c, o, { f: 392, at: 0.18, dur: 0.35 }); note(c, o, { f: 261.63, at: 0.36, dur: 0.7 }); },
  tap: (c, o) => note(c, o, { f: 1000, dur: 0.06, type: "triangle", gain: 0.16 }),
  sent: (c, o) => { note(c, o, { f: 700, dur: 0.07, type: "triangle", gain: 0.14 }); note(c, o, { f: 940, at: 0.05, dur: 0.09, type: "triangle", gain: 0.14 }); },
  received: (c, o) => { note(c, o, { f: 620, dur: 0.09, type: "triangle", gain: 0.16 }); note(c, o, { f: 780, at: 0.06, dur: 0.12, type: "triangle", gain: 0.16 }); },
};

function run(fn, { force = false } = {}) {
  const p = load();
  if (!force && (!p.enabled || p.volume <= 0)) return;
  const c = getCtx();
  if (!c) return;
  const master = c.createGain();
  master.gain.value = (p.volume / 100) ** 1.6; // perceptual curve
  master.connect(c.destination);
  try { fn(c, master); } catch { /* ignore */ }
}

// Which kinds of sound each name belongs to, so the right toggle applies.
const ROOM_CUES = new Set(["join", "leave", "ended"]);
const APP_CUES = new Set(["tap", "sent", "received"]);

export function playSound(name) {
  const p = load();
  if (name === "notify") return run(TONE_FN[p.tone] || TONE_FN.signal);
  if (name === "message") return run(TONE_FN[p.messageTone] || TONE_FN.pluck);
  if (ROOM_CUES.has(name) && !p.roomCues) return;
  if (APP_CUES.has(name) && !p.appSounds) return;
  if (CUE_FN[name]) run(CUE_FN[name]);
}

// Settings preview: plays even if the master switch is off (so the user can
// audition tones) but always at the chosen volume.
export function previewTone(id) {
  const fn = TONE_FN[id];
  if (fn) run(fn, { force: true });
}
export { TONES };
