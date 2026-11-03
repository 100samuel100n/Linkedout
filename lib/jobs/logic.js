// Pure job logic: transparency score, ranking, match scoring, scam signals, lifecycle. No database.
//
// Principle: companies can pay for TOOLS (posting, pipeline, analytics), never for the truth layer or for a hidden
// advantage in organic ranking. Rank below uses only things anyone can see: transparency, freshness, verification.

export const WORK_MODES = ["remote", "hybrid", "onsite"];
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship", "temporary", "freelance"];
export const SENIORITY = ["intern", "entry", "mid", "senior", "lead", "executive"];
export const PERIODS = ["hour", "day", "month", "year"];
export const STAGES = ["new", "screening", "interview", "final", "offer", "hired", "rejected", "withdrawn"];
export const STAGE_LABEL = { new: "Applied", screening: "Screening", interview: "Interview", final: "Final decision", offer: "Offer", hired: "Hired", rejected: "Not selected", withdrawn: "Withdrawn" };
export const REPORT_REASONS = { scam: "Scam", fake_company: "Fake company", impersonation: "Impersonation", misleading_salary: "Misleading salary", misleading_description: "Misleading description", expired: "Expired", duplicate: "Duplicate", recruitment_fee: "Recruitment fee", suspicious_link: "Suspicious external link", other: "Other" };

// ---- lifecycle: draft → review → published ⇄ paused → filled | expired | closed | withdrawn
export const JOB_STATUSES = ["draft", "review", "published", "paused", "filled", "expired", "closed", "withdrawn"];
const NEXT = { draft: ["review", "published", "withdrawn"], review: ["published", "draft", "withdrawn"], published: ["paused", "filled", "closed", "withdrawn", "expired"], paused: ["published", "filled", "closed", "withdrawn"], filled: [], expired: ["published"], closed: ["published"], withdrawn: [] };
export const canMove = (from, to) => (NEXT[from] || []).includes(to);
// "Accepting applications" is a state of a published job, not a separate row state.
export const acceptingApplications = (j, now = Date.now()) => j.status === "published" && !(j.deadline && new Date(j.deadline).getTime() < now);

// ---- transparency score (0-100). Missing items lower the score; they never hide the job.
const filled = (a) => Array.isArray(a) && a.filter((x) => String(x || "").trim()).length > 0;
export function transparency(j) {
  const salary = j.salary_min != null && j.salary_max != null && Number(j.salary_max) >= Number(j.salary_min) && !!j.currency && !!j.salary_period;
  const items = [
    { key: "salary", label: "Salary disclosed", pts: 20, ok: salary },
    { key: "location", label: "Location disclosed", pts: 10, ok: filled(j.locations) || j.workplace_mode === "remote" },
    { key: "mode", label: "Work arrangement disclosed", pts: 10, ok: WORK_MODES.includes(j.workplace_mode) },
    { key: "type", label: "Employment type disclosed", pts: 5, ok: EMPLOYMENT_TYPES.includes(j.employment_type) },
    { key: "responsibilities", label: "Responsibilities listed", pts: 10, ok: filled(j.responsibilities) },
    { key: "requirements", label: "Requirements listed", pts: 10, ok: filled(j.requirements) },
    { key: "benefits", label: "Benefits listed", pts: 10, ok: filled(j.benefits) },
    { key: "process", label: "Hiring process described", pts: 10, ok: filled(j.hiring_process) },
    { key: "deadline", label: "Application deadline", pts: 5, ok: !!j.deadline },
    { key: "description", label: "Real description", pts: 5, ok: String(j.description || "").trim().length >= 200 },
    { key: "skills", label: "Skills listed", pts: 5, ok: filled(j.skills) },
  ];
  const score = items.reduce((a, i) => a + (i.ok ? i.pts : 0), 0);
  return { score, level: score >= 85 ? "Excellent" : score >= 65 ? "Good" : score >= 40 ? "Fair" : "Low", items };
}

// ---- organic ranking: transparency + freshness + verification. Nothing a company can buy.
export function rankScore(j, now = Date.now()) {
  const ageDays = Math.max(0, (now - new Date(j.published_at || j.created_at).getTime()) / 864e5);
  const fresh = Math.max(0, 30 - ageDays);            // 30 points fading to 0 over a month
  const ver = j.verification === "verified" ? 10 : j.verification === "associated" ? 5 : 0;
  return (j.transparency ?? 0) * 0.6 + fresh + ver;
}

// ---- trust: scam / low-quality signals. Any hit sends a new community post to review before it goes live.
export function scamSignals(j) {
  const t = `${j.title || ""} ${j.description || ""} ${(j.requirements || []).join(" ")} ${j.external_url || ""}`.toLowerCase(), out = [];
  if (/(registration|application|processing|training|interview|security)\s+fee|pay (a )?fee|send (money|payment)|western union|mpesa.{0,20}(send|pay)|deposit required|buy (your own )?(equipment|kit)/.test(t)) out.push("asks the candidate to pay");
  if (/whatsapp|telegram/.test(t) && /(apply|contact|reach)/.test(t)) out.push("sends applicants to a chat app");
  if (/(@gmail\.|@yahoo\.|@outlook\.|@hotmail\.)/.test(t)) out.push("free-mail contact address");
  if (/earn\s+\$?\d[\d,]*\s*(\/|per)\s*(day|week)|no experience (needed|required).{0,40}(earn|\$)|guaranteed (income|salary)/.test(t)) out.push("unrealistic pay promise");
  if (/[A-Z]{12,}/.test(String(j.title || ""))) out.push("shouting title");
  if (j.external_url && /bit\.ly|tinyurl|t\.co|goo\.gl|is\.gd|cutt\.ly/.test(j.external_url)) out.push("shortened external link");
  return out;
}

// ---- match score for recommendations. prefs: { titles[], skills[], locations[], modes[], salaryMin, seniority }
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+#. ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => new Set(norm(s).split(" ").filter((x) => x.length > 2));
export function matchScore(j, prefs = {}, behavior = {}) {
  const reasons = []; let got = 0, max = 0;
  const add = (w, frac, why) => { max += w; got += w * frac; if (frac >= 0.5 && why) reasons.push(why); };
  const jobSkills = (j.skills || []).map(norm).filter(Boolean), mySkills = new Set((prefs.skills || []).map(norm));
  if (mySkills.size) { const hit = jobSkills.filter((s) => mySkills.has(s)); add(35, jobSkills.length ? Math.min(1, hit.length / Math.min(jobSkills.length, 4)) : 0, hit.length ? `Matches your skills: ${hit.slice(0, 3).join(", ")}` : null); }
  if ((prefs.titles || []).length) { const jt = toks(j.title); const best = Math.max(...prefs.titles.map((t) => { const tt = toks(t); const inter = [...tt].filter((x) => jt.has(x)).length; return tt.size ? inter / tt.size : 0; })); add(25, best, best >= 0.5 ? "Close to the roles you look for" : null); }
  if ((prefs.locations || []).length) { const jl = (j.locations || []).map(norm).join(" "); const ok = j.workplace_mode === "remote" || prefs.locations.some((l) => jl.includes(norm(l))); add(15, ok ? 1 : 0, ok ? (j.workplace_mode === "remote" ? "Remote" : "In your preferred location") : null); }
  if ((prefs.modes || []).length) add(10, prefs.modes.includes(j.workplace_mode) ? 1 : 0, prefs.modes.includes(j.workplace_mode) ? `${j.workplace_mode} work, as you prefer` : null);
  if (prefs.salaryMin && j.salary_max != null) add(10, Number(j.salary_max) >= Number(prefs.salaryMin) ? 1 : 0, Number(j.salary_max) >= Number(prefs.salaryMin) ? "Pays at or above your minimum" : null);
  if (prefs.seniority) add(5, prefs.seniority === j.seniority ? 1 : 0, prefs.seniority === j.seniority ? "Your level" : null);
  if (behavior.companyIds?.includes(j.company_id)) { max += 5; got += 5; reasons.push("A company you've shown interest in"); }
  if (!max) return { score: null, reasons: [] };
  return { score: Math.round((got / max) * 100), reasons: reasons.slice(0, 4) };
}

// ---- "what the role reports": dimensions → themes (see lib/stories/themes.js). Shows the share of recent reports raising concern.
export const ROLE_DIMENSIONS = [
  { key: "compensation", label: "Compensation", themes: ["unpaid_wages", "salary_change"] },
  { key: "management", label: "Management", themes: ["intimidation", "unclear", "discrimination", "harassment"] },
  { key: "workload", label: "Workload", themes: ["unpaid_ot", "burnout"] },
  { key: "worklife", label: "Work-life balance", themes: ["burnout", "unpaid_ot", "rto"] },
  { key: "career", label: "Career progression", themes: ["broken_promise", "hiring_freeze"] },
  { key: "security", label: "Job security", themes: ["layoffs"] },
  { key: "culture", label: "Culture", themes: ["harassment", "discrimination", "intimidation"] },
  { key: "flexibility", label: "Flexibility", themes: ["rto"] },
];
export const concernLevel = (share) => (share >= 0.4 ? "High concern" : share >= 0.2 ? "Some concern" : "Low concern");

// Word-overlap between a job title and a story's role/department, so "Software Engineer" finds "Senior Software Engineer".
export function titleOverlap(a, b) { const x = toks(a), y = toks(b); if (!x.size || !y.size) return 0; return [...x].filter((t) => y.has(t)).length / Math.min(x.size, y.size); }
