<<<<<<< HEAD
// Anonymous handles for accounts that sign up without choosing one (Google / Apple sign-in).
//  * generateAlias(): asks the AI for a fresh, witty workplace-satire handle (only here, where it was automatic before),
//    and falls back to the local generator on any failure or if it takes more than 2.5 s. Never blocks signup.
//  * randomAlias(): the local generator: three patterns over large word lists, so handles are varied and rarely need a number.
// Turn the AI part off with ALIAS_AI=false. Everyone can still change their handle in profile settings.
const ADJ = ["Unpaid", "Overqualified", "Underpaid", "Sleepless", "Gaslit", "Burnt", "Ghosted", "Recycled", "Laminated", "Lukewarm", "Reluctant", "Rebranded", "Offboarded", "Furloughed", "Caffeinated", "Feral", "Nocturnal", "Skeptical", "Unhinged", "Undercover", "Pivoting", "Disruptive", "Agile", "Synergistic", "Remote", "Hybrid", "Mandatory", "Optional", "Quietly", "Loudly", "Escaped", "Retired", "Haunted", "Cursed", "Sarcastic", "Defiant", "Notorious", "Anonymous", "Forgotten", "Stapled", "Passive", "Aggressive", "Nonbillable", "Unscheduled", "Rogue", "Mildly", "Chronic", "Wandering", "Pixelated", "Sleepy", "Cynical", "Honest", "Blunt", "Tired", "Fabled", "Wistful", "Tactical", "Overbooked", "Understaffed", "Unlinked", "Outbound"];
const NOUN = ["Stapler", "Whiteboard", "Printer", "Lanyard", "Standup", "Roadmap", "Backlog", "Sprint", "Dashboard", "Deadline", "Calendar", "Spreadsheet", "Keyboard", "Cubicle", "Elevator", "Kettle", "Mug", "Badge", "Hotdesk", "Webcam", "Mute", "Inbox", "Memo", "Offsite", "Quarter", "Synergy", "Intern", "Raccoon", "Otter", "Pigeon", "Badger", "Gremlin", "Heron", "Moth", "Ferret", "Walrus", "Lobster", "Magpie", "Yak", "Capybara", "Wombat", "Narwhal", "Possum", "Gecko", "Falcon", "Cactus", "Comet", "Lighthouse", "Compass", "Anchor", "Kite", "Teapot", "Biscuit", "Noodle", "Pickle", "Waffle", "Turnip", "Paperclip", "Sticky", "Bagel", "Monday", "Friday", "Draft", "Cursor", "Tab", "Footnote", "Comma", "Margin", "Ledger"];
const ROLE = ["Whisperer", "Survivor", "Enjoyer", "Refugee", "Defector", "Anthropologist", "Escapee", "Veteran", "Archivist", "Cartographer", "Wrangler", "Sommelier", "Skeptic", "Philosopher", "Mechanic", "Poet", "Detective", "Apprentice", "Nomad", "Oracle"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const num = () => String(10 + Math.floor(Math.random() * 90));

// 3 patterns: Adjective+Noun · Noun+Role · Adjective+Noun+Role. A 2-digit tag is added only ~1 time in 4.
export function randomAlias() {
  for (let i = 0; i < 20; i++) {
    const r = Math.random();
    const base = r < 0.45 ? pick(ADJ) + pick(NOUN) : r < 0.8 ? pick(NOUN) + pick(ROLE) : pick(ADJ) + pick(NOUN) + pick(ROLE);
    const out = base + (Math.random() < 0.25 ? num() : "");
    if (out.length <= 26) return out;          // never cut a word in half: pick again instead
  }
  return pick(ADJ) + pick(NOUN);
}

const BAD = /(fuck|shit|cunt|nigg|fagg|rape|nazi|hitler|porn|sex|dick|cock|pussy|whore|slut|kill|suicid|terror|isis|trump|biden|modi)/i;
export const isValidAlias = (s) => typeof s === "string" && /^[A-Za-z][A-Za-z0-9]{5,27}$/.test(s) && !BAD.test(s);

// AI-first; always resolves to a valid handle.
export async function generateAlias() {
  if (String(process.env.ALIAS_AI || "").toLowerCase() === "false") return randomAlias();
  try {
    const { callModel, isAiConfigured } = await import("@/lib/ai");
    if (!isAiConfigured()) return randomAlias();
    const seeds = [pick(NOUN), pick(NOUN), pick(ADJ)].join(", ");
    const out = await Promise.race([
      callModel({
        system: "You invent anonymous usernames for a social app about the honest truth of working life, with a dry, witty, slightly absurd workplace-satire tone. Reply with ONE username only: 2 or 3 words joined in CamelCase, letters only, 8 to 24 characters. It must be original and funny or striking, never generic. No real people, brands, politics, religion, sexual content, profanity or slurs. No digits, no spaces, no punctuation, no explanation.",
        user: `Loose inspiration (use or ignore): ${seeds}. Variation id: ${Math.random().toString(36).slice(2, 7)}.`,
        maxTokens: 24,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("alias ai timeout")), 2500)),
    ]);
    const cand = String(out || "").trim().split(/\s+/)[0].replace(/[^A-Za-z]/g, "");
    return isValidAlias(cand) ? cand : randomAlias();
  } catch { return randomAlias(); }
}

// ---------------------------------------------------------------------------------------------------------------------
// Display names for ANONYMOUS stories/posts ("Anonymous Otter" before). Spaced, title-cased, more characterful, and
// AI-written when the AI is available (falls back to the local generator within ~1.8 s, never blocks posting).
// Admins can rewrite any of them later (lib/admin/aliases.js); the AI is also used for the admin's "suggest names" button.
const A_MOOD = ["Midnight", "Sleepless", "Quiet", "Reluctant", "Unbothered", "Overcaffeinated", "Mildly Haunted", "Politely Furious", "Gently Defiant", "Dramatically Underpaid", "Last-Minute", "Off-the-Record", "Slightly Feral", "Chronically Online", "Wildly Overqualified", "Carefully Anonymous", "Freshly Laid-Off", "Long-Suffering", "Deeply Unmuted", "Perfectly Fine"];
const A_THING = ["Spreadsheet", "Lighthouse", "Stapler", "Org Chart", "Standup", "Whiteboard", "Elevator", "Pigeon", "Kettle", "Roadmap", "Cubicle", "Backlog", "Lanyard", "Parking Spot", "Printer", "Sticky Note", "Calendar Invite", "Break Room", "Conference Call", "Exit Interview", "Corner Office", "Fire Drill", "Group Chat", "Open Floor", "Reply-All", "Badge Reader", "Coffee Machine", "Annual Review", "Quarterly Goal", "Slide Deck"];
const A_ROLE = ["Whisperer", "Survivor", "Witness", "Historian", "Defector", "Bystander", "Escapee", "Archivist", "Cartographer", "Night Watch", "Ghost", "Insider", "Source", "Narrator", "Oracle", "Apprentice", "Wanderer", "Sommelier", "Detective", "Lookout"];
const A_ANIMAL = ["Otter", "Heron", "Raccoon", "Badger", "Owl", "Fox", "Moth", "Walrus", "Magpie", "Lynx", "Gecko", "Capybara", "Falcon", "Crow", "Hedgehog", "Stoat", "Tortoise", "Marmot"];
const spaced = (a) => a[Math.floor(Math.random() * a.length)];
export function randomAnonLabel() {
  for (let i = 0; i < 20; i++) {
    const r = Math.random();
    const out = r < 0.3 ? `${spaced(A_MOOD)} ${spaced(A_ANIMAL)}` : r < 0.6 ? `The ${spaced(A_MOOD)} ${spaced(A_THING)} ${spaced(A_ROLE)}` : r < 0.8 ? `${spaced(A_THING)} ${spaced(A_ROLE)}` : `${spaced(A_MOOD)} ${spaced(A_ANIMAL)} in ${spaced(["Accounts", "Legal", "Sales", "Ops", "HR", "Finance", "Engineering", "Marketing", "Support", "Procurement"])}`;
    if (out.length <= 34) return out;
  }
  return `${spaced(A_MOOD)} ${spaced(A_ANIMAL)}`;
}
const BAD_LABEL = BAD;
export const isValidLabel = (s) => typeof s === "string" && /^[A-Za-z][A-Za-z0-9 '’\-]{3,33}$/.test(s.trim()) && !BAD_LABEL.test(s) && s.trim().split(/\s+/).length <= 7;
const AI_SYSTEM = "You invent anonymous display names for a social app about the honest truth of working life. Tone: dry, witty, a little absurd, never cruel. Each name is 2 to 5 words, Title Case, letters and spaces only (an apostrophe or hyphen is fine), 8 to 32 characters. Original and memorable, never generic like 'Anonymous User'. No real people, brands, politics, religion, sexual content, profanity or slurs. No digits.";
async function aiNames(n, hint) {
  const { callModel, isAiConfigured } = await import("@/lib/ai");
  if (!isAiConfigured()) return null;
  const out = await callModel({ system: AI_SYSTEM + ` Reply with ONLY a JSON array of ${n} distinct strings.`, user: `${hint ? `Loose theme (use or ignore): ${hint}. ` : ""}Variation id: ${Math.random().toString(36).slice(2, 7)}.`, maxTokens: 40 + n * 16 });
  const arr = JSON.parse(String(out || "").replace(/```json|```/g, "").trim());
  return Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(isValidLabel) : null;
}
export async function generateAnonLabel() {
  if (String(process.env.ALIAS_AI || "").toLowerCase() === "false") return randomAnonLabel();
  try {
    const got = await Promise.race([aiNames(1), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 1800))]);
    return got?.[0] || randomAnonLabel();
  } catch { return randomAnonLabel(); }
}
// n distinct suggestions for the admin (AI first, topped up locally so there are always n).
export async function suggestLabels(n = 6, hint = "") {
  let got = [];
  try { got = (await Promise.race([aiNames(n, hint), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || []; } catch { /* local only */ }
  const set = new Set(got);
  let guard = 0; while (set.size < n && guard++ < 60) set.add(randomAnonLabel());
  return [...set].slice(0, n);
=======
const ADJECTIVES = ["Pixelated", "Feral", "Chronic", "Unhinged", "Undercover", "Nocturnal", "Skeptical", "Overworked", "Caffeinated", "Wandering"];
const NOUNS = ["Intern", "Raccoon", "Otter", "Analyst", "Wolf", "Consultant", "Gremlin", "Pigeon", "Contractor", "Badger"];

export function randomAlias() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${a}${n}#${num}`;
>>>>>>> origin/main
}
