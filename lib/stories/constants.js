// LinkedOut Stories — shared vocabulary. One source of truth for the server
// (validation) and the web UI (pickers). The native app mirrors this file.
//
// The fundamental object of LinkedOut is the lived experience, so everything
// here is about describing an experience precisely — and about being precise
// about how much the platform actually knows (evidence levels), rather than
// treating "someone said it" as "it is true".

// What's actually happening? — the categories a Story can carry (1–3 each).
export const STORY_CATEGORIES = [
  "Laid off", "Fired", "Resigned", "Toxic workplace", "Bad manager", "Great manager",
  "Salary issue", "Unpaid wages", "Broken promises", "Discrimination", "Burnout",
  "Workplace harassment", "Recruiter experience", "Interview experience", "Company culture",
  "Promotion issue", "Internship experience", "Management failure", "Workplace success",
  "Whistleblowing", "Career reality", "Nobody tells you this",
];

// Structured story formats. `layout` decides which extra fields the composer shows.
export const STORY_FORMATS = [
  { key: "experience",   label: "My Experience",        layout: "plain",     hint: "Something happened at work. Tell it your way." },
  { key: "laid_off",     label: "I Was Laid Off",       layout: "layoff",    hint: "Say it plainly. You are not alone." },
  { key: "quit",         label: "I Quit",               layout: "plain",     hint: "Why you left, and what you were told on the way out." },
  { key: "fired",        label: "I Was Fired",          layout: "plain",     hint: "What happened, and what reason you were given." },
  { key: "interview",    label: "My Interview Experience", layout: "interview", hint: "Rounds, questions, silence, offers." },
  { key: "ghosted",      label: "They Ghosted Me",      layout: "ghosted",   hint: "Where in the process did they go quiet?" },
  { key: "salary",       label: "Salary Reality",       layout: "salary",    hint: "Advertised vs offered vs what you actually got." },
  { key: "management",   label: "Management Story",     layout: "plain",     hint: "Describe behaviours, not a person's character." },
  { key: "red_flag",     label: "Workplace Red Flag",   layout: "flag",      hint: "🚩 One concrete thing others should know." },
  { key: "green_flag",   label: "Workplace Green Flag", layout: "flag",      hint: "💚 They actually did the right thing." },
  { key: "whistleblower",label: "Whistleblower",        layout: "plain",     hint: "Higher-risk. Read the safety notes first." },
  { key: "confession",   label: "Confession",           layout: "plain",     hint: "Something you did, or didn't do." },
  { key: "warning",      label: "Warning Others",       layout: "plain",     hint: "What you wish someone had told you." },
  { key: "only_one",     label: "Am I the Only One?",   layout: "plain",     hint: "Ask whether anyone else is seeing this." },
  { key: "jd_reality",   label: "Job Description vs Reality", layout: "jd",  hint: "What the posting said vs what the job is." },
  { key: "not_in_jd",    label: "What Wasn't in the Job Description", layout: "notinjd", hint: "The responsibilities nobody mentioned." },
];

export const WHO_OPTIONS = [
  { key: "current", label: "Current employee" },
  { key: "former", label: "Former employee" },
  { key: "applicant", label: "Applicant" },
  { key: "customer", label: "Customer" },
];

export const WANT_OPTIONS = [
  { key: "sharing", label: "Just sharing" },
  { key: "support", label: "Support" },
  { key: "advice", label: "Advice" },
  { key: "warn", label: "Warn others" },
  { key: "find_others", label: "Find others who experienced this" },
  { key: "accountability", label: "Accountability" },
  { key: "learn", label: "I want others to learn from this" },
];

export const OUTCOMES = [
  { key: "ongoing", label: "Still ongoing" },
  { key: "resolved", label: "Resolved" },
  { key: "unresolved", label: "Unresolved" },
  { key: "escalated", label: "Escalated" },
  { key: "company_responded", label: "Company responded" },
  { key: "reinstated", label: "Employee reinstated" },
  { key: "left", label: "Left company" },
];

export const LEAVE_REASONS = [
  "Pay", "Management", "Culture", "Burnout", "Career growth", "Layoff", "Relocation",
  "Better opportunity", "Toxic environment", "Ethics", "Work-life balance", "Other",
];

export const GHOST_STAGES = ["Applied", "Interviewed", "Final round", "Received offer"];

export const MODES = ["real", "alias", "anon"];

// Evidence levels. This is the credibility architecture: it describes what the
// platform knows, never "this is true".
export const EVIDENCE_LEVELS = {
  personal:   { rank: 0, label: "Personal account",          blurb: "Someone describes what they experienced." },
  evidence:   { rank: 1, label: "Evidence attached",         blurb: "Supporting material was provided. Not independently checked." },
  multiple:   { rank: 2, label: "Multiple independent reports", blurb: "Similar reports from different accounts exist." },
  public:     { rank: 3, label: "Publicly documented",       blurb: "Supported by public records or reporting." },
};

export const EVIDENCE_KINDS = ["email", "contract", "screenshot", "payslip", "message", "job description", "HR communication", "other"];

// Support Circles that exist from day one. Anyone can join; membership is
// anonymous (keyed by alias, never shown).
export const DEFAULT_CIRCLES = [
  { slug: "recently-laid-off", name: "Recently Laid Off", description: "You were let go in the last few months. Nobody here will tell you to 'network'." },
  { slug: "toxic-manager-survivors", name: "Toxic Manager Survivors", description: "You worked for one. You're recovering from one. You're not imagining it." },
  { slug: "first-job-horror", name: "First Job Horror Stories", description: "Early-career chaos, unpaid trials and 'we're a family' contracts." },
  { slug: "after-burnout", name: "Returning to Work After Burnout", description: "Slow, careful, honest. Coming back without pretending you're fine." },
  { slug: "interview-ghosting", name: "Ghosted After the Final Round", description: "You did the work. They went silent." },
  { slug: "whistleblowers-support", name: "Speaking Up", description: "Support for people who raised something and paid for it. Not a place for evidence or legal advice." },
];

export const STORY_LIMITS = { title: 140, body: 8000, short: 1200, field: 120 };

export const validKey = (list, key) => list.some((x) => (x.key ?? x) === key);

// ---------------------------------------------------------------------------------------------
// Risk tiers. Not every story carries the same risk to the person telling it, or to people in it.
// A salary figure and a harassment report should not be handled identically, so the tier changes
// what we warn about, what we default to, and what we do on the server.
//   standard  : personal experience with low legal/safety exposure
//   elevated  : accusations about a manager/company, dismissals, confessions (defamation and
//               retaliation exposure): anonymous suggested, wording guidance, named-person check
//   high      : harassment, discrimination, whistleblowing: anonymous pre-selected, kept out of
//               search engines by the SERVER (not a choice), strongest safety notes
// This is guidance, not legal advice, and the copy says so.
// ---------------------------------------------------------------------------------------------
const FORMAT_LEVEL = { whistleblower: "high", fired: "elevated", management: "elevated", red_flag: "elevated", confession: "elevated", warning: "elevated" };
const CATEGORY_LEVEL = { "Workplace harassment": "high", Discrimination: "high", Whistleblowing: "high", "Toxic workplace": "elevated", "Bad manager": "elevated", "Unpaid wages": "elevated", "Management failure": "elevated" };
const RANK = { standard: 0, elevated: 1, high: 2 };
export const RISK_COPY = {
  standard: { label: "Standard", notes: ["Describe what you experienced and what was said. Anyone mentioned can ask for a review, and companies have a right of reply."] },
  elevated: { label: "Higher care", notes: [
    "Stick to what you saw and what was said. Avoid saying a named person committed a crime or acted with bad intent.",
    "Retaliation is a real risk when you're still employed. Posting anonymously is safer, and we'll warn you if the details could identify you.",
    "Remove names of private individuals. Describe their role instead (\"my manager\").",
  ] },
  high: { label: "Highest care", notes: [
    "Reporting harassment, discrimination or wrongdoing can carry legal and personal risk. Anonymous mode is pre-selected; think before switching it off.",
    "Don't attach documents that belong to your employer or contain other people's private data. Evidence you share is stored privately, never shown.",
    "This story is kept out of search engines automatically to protect you, and cannot be indexed.",
    "Consider speaking to a lawyer, a union, or a whistleblower or harassment support service first. This is guidance, not legal advice.",
  ] },
};
export function storyRisk(format, categories = []) {
  let level = FORMAT_LEVEL[format] || "standard";
  for (const c of categories || []) { const l = CATEGORY_LEVEL[c]; if (l && RANK[l] > RANK[level]) level = l; }
  return { level, ...RISK_COPY[level], defaultMode: level === "high" ? "anon" : level === "elevated" ? "anon" : null, forceNoindex: level === "high" };
}
