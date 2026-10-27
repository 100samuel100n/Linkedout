// UI configuration constants — used by both the composer and by
// scripts/seed-content.js (the real accounts that create the app's
// initial content). Actual content (posts, companies, jobs, rooms) is
// NOT seeded from static data anymore — see lib/content/db.js's comment
// for why, and scripts/seed-content.js for how real accounts create it.
export const POST_TYPES = ["Rant", "Confession", "Meme", "Humble-Brag Parody", "Poll", "Question", "Event"];

export const IDENTITY_MODES = [
  { key: "real", label: "Real Name" },
  { key: "alias", label: "Alias" },
  { key: "anon", label: "Full Anonymous" },
];

export const MOODS = [
  "Barely Holding On",
  "Job Hunting in Silence",
  "Thriving (Lying)",
  "Imposter Syndrome, Party of One",
  "Chaotic Neutral",
];

export const CATEGORIES = [
  "Layoffs", "Burnout", "Bad Bosses", "Interview Horror Stories", "Salary Transparency",
  "Career Pivots", "Startup Chaos", "Corporate Jargon", "Remote Work", "Imposter Syndrome",
];

// Chosen at signup, shown on profile, used as an optional Feed filter —
// not fed into any ranking/recommendation algorithm (consistent with
// "no algorithmic inspiration, ever").
export const INTERESTS = [
  "Layoffs", "Burnout", "Career Pivots", "Salary Transparency", "Startup Chaos",
  "Corporate Jargon", "Interview Horror Stories", "Imposter Syndrome", "Management", "Remote Work",
];

export const ACCOUNT_TYPES = [
  { key: "personal", label: "Personal" },
  { key: "business", label: "Business" },
];

export const VISIBILITY_OPTIONS = [
  { key: "public", label: "Public — shows in the main feed" },
  { key: "unlisted", label: "Unlisted — only visible on your profile / via direct link" },
];

export const ROAST_LINES = [
  "\u201cResults-driven professional\u201d — so is everyone else's resume. You're a photocopy of a photocopy.",
  "Five bullet points under your last role and not one number in any of them. What did you actually do — vibes?",
  "\u201cProficient in Microsoft Excel\u201d is not a personality trait.",
  "You listed \u201cleadership\u201d directly under a two-month internship. Bold strategy.",
  "Three different fonts on one page. I can feel your Sunday-night panic through the PDF.",
];

// "Sponsored Roasts" — the ad format described in the PRD: brands pay to
// be self-deprecating rather than aspirational, opt-in, and always labeled.
// These are fictional advertisers, not real companies. Ads are platform
// inventory, not user-submitted content, so they're still seeded directly
// (see lib/content/db.js) rather than created by a seed account.
export const ADS = [
  {
    id: 1, brand: "Fernwell Insurance",
    tagline: "We deny claims almost as fast as your manager denies PTO. Now hiring actuaries (and empathy).",
    cta: "See if we cover burnout",
    // Add a real https `url` to an ad and its button appears; no url, no button.
  },
  {
    id: 2, brand: "LoopMail",
    tagline: "Built by people who also cried during a \u2018quick sync.\u2019 Unsubscribe from your job, not from us.",
    cta: "Try LoopMail free",
  },
  {
    id: 3, brand: "BrightPath Career Coaching",
    tagline: "We'll help you land your next role before your current one lands on you.",
    cta: "Book a session",
  },
];

export const INDUSTRIES = [
  "Technology", "Software & SaaS", "Finance & Banking", "Fintech", "Insurance", "Consulting", "Healthcare", "Pharma & Biotech",
  "Education", "Retail & E-commerce", "Manufacturing", "Logistics & Transport", "Energy & Utilities", "Telecommunications",
  "Media & Entertainment", "Marketing & Advertising", "Real Estate & Construction", "Hospitality & Travel", "Agriculture",
  "Government & Public Sector", "Non-profit", "Legal Services", "Staffing & Recruitment", "Other",
];
