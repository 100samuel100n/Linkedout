// Shared by the server (which picks the push sound), the web app and — as
// a copy in the native app — the phone: the tone catalogue and the default
// sound preferences. Keep the two copies identical.
export const TONES = [
  { id: "signal", label: "Signal", desc: "The LinkedOut classic" },
  { id: "glass", label: "Glass", desc: "Bright and crisp" },
  { id: "bubble", label: "Bubble", desc: "Playful pop" },
  { id: "pluck", label: "Pluck", desc: "Warm plucked string" },
  { id: "marimba", label: "Marimba", desc: "Three quick notes" },
  { id: "bell", label: "Bell", desc: "Clear and resonant" },
  { id: "drop", label: "Drop", desc: "Soft water drop" },
  { id: "radar", label: "Radar", desc: "Two gentle pings" },
  { id: "soft", label: "Soft", desc: "Low and unobtrusive" },
];
export const TONE_IDS = TONES.map((t) => t.id);

export const DEFAULT_SOUND_PREFS = {
  enabled: true,      // master switch for all notification sounds
  volume: 80,         // 0-100, in-app sounds (phones' push volume follows the device)
  tone: "signal",     // general notifications
  messageTone: "pluck", // new messages
  roomCues: true,     // join / leave / session-ended cues in Vent Rooms
  appSounds: true,    // small UI sounds (taps, sends)
  vibrate: true,      // vibration on push (phones)
};

export function normalizeSoundPrefs(input) {
  const p = { ...DEFAULT_SOUND_PREFS, ...(input && typeof input === "object" ? input : {}) };
  return {
    enabled: !!p.enabled,
    volume: Math.max(0, Math.min(100, Math.round(Number(p.volume) || 0))),
    tone: TONE_IDS.includes(p.tone) ? p.tone : DEFAULT_SOUND_PREFS.tone,
    messageTone: TONE_IDS.includes(p.messageTone) ? p.messageTone : DEFAULT_SOUND_PREFS.messageTone,
    roomCues: !!p.roomCues,
    appSounds: !!p.appSounds,
    vibrate: !!p.vibrate,
  };
}
