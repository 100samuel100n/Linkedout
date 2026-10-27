// Required fields per story-composer step. Shared by the web composer (native keeps a copy in
// screens/StoryComposerScreen.js). Returns [{ key, label }] for what is still missing, so the Continue button can be
// disabled and the reason shown, instead of letting people walk through empty steps.
// `layout` is the format's layout from STORY_FORMATS: plain | layoff | interview | ghosted | salary | flag | jd | notinjd.
const ROLE_LAYOUTS = new Set(["interview", "ghosted", "salary", "jd", "notinjd"]);
export function missingForStep(step, { format, layout, f = {}, details = {} }) {
  const m = [];
  if (step === 0 && !format) m.push({ key: "format", label: "Pick a story type" });
  if (step === 1) {
    if (!f.who) m.push({ key: "who", label: "Who you are in this story" });
    if (!(f.companyName || "").trim() && !(f.industry || "").trim()) m.push({ key: "where", label: "Company name or industry" });
    if (!(f.period || "").trim() && !f.happenedOn) m.push({ key: "period", label: "When it happened" });
  }
  if (step === 2) {
    if (ROLE_LAYOUTS.has(layout) && !(f.roleTitle || "").trim()) m.push({ key: "roleTitle", label: "Your role" });
    if (layout === "interview" && !details.outcome) m.push({ key: "outcome", label: "Outcome" });
    if (layout === "ghosted" && !details.stage) m.push({ key: "stage", label: "How far you got" });
    if (layout === "salary" && !(details.currency || "").trim()) m.push({ key: "currency", label: "Currency" });
  }
  if (step === 3) {
    const n = (f.body || "").trim().length;
    if (n < 20) m.push({ key: "body", label: `Your story (at least 20 characters, ${n} so far)` });
  }
  return m;
}
