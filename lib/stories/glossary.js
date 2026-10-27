// Built-in Reality Translator glossary. Free for every plan, deterministic, no AI.
// Every entry is an INTERPRETATION of what a phrase often signals — never a claim
// about any particular employer. The API always returns the disclaimer below.
export const SPEAK_DISCLAIMER = "This is an interpretation of common workplace language, not a statement about any specific company. Ask the employer to be specific.";

export const GLOSSARY = {
  job: [
    ["fast-paced environment", "Expect a high workload and shifting priorities.", "What does a normal week look like, and how are priorities set?"],
    ["wear many hats", "The role may cover duties from several jobs.", "Which responsibilities are core, and which are 'extras'?"],
    ["self-starter", "Little onboarding or direction should be expected.", "What does onboarding look like in the first 30 days?"],
    ["work hard, play hard", "Long hours, with social events counted as part of the culture.", "How often is work expected outside normal hours?"],
    ["we're like a family", "Boundaries between work and personal life may be blurred.", "How are decisions like layoffs or pay handled?"],
    ["competitive salary", "Pay may not be stated because it may not be at the top of the market.", "What is the salary range for this role?"],
    ["rockstar", "Possibly one person doing the work of several.", "What is the team size and who does what?"],
    ["flexible hours", "Can mean freedom, or that you are expected to be reachable at any hour.", "Are there core hours and an expected response time?"],
    ["unlimited pto", "Time off may be harder to track, and in practice often less than a fixed allowance.", "How many days did the team actually take last year?"],
    ["dynamic environment", "Change is frequent; structure may be limited.", "How long has the team been in its current form?"],
    ["hit the ground running", "Training will be minimal.", "Who will help me in the first month?"],
    ["other duties as assigned", "The job description may grow after you start.", "Which other duties have people in this role been given recently?"],
    ["passionate", "Employers may be hoping you accept lower pay or longer hours for the mission.", "How is workload managed when someone is out?"],
    ["hybrid", "Policies vary widely and can change; check how many days are required in the office.", "How many days are required on site, and has that changed in the last year?"],
  ],
  hr: [
    ["we need to have a conversation", "Something serious is being raised. It might be feedback, a performance concern, or a change.", "Can you tell me in advance what it's about, and who will attend?"],
    ["your employment may be at risk", "A formal warning stage may be starting. Ask for it in writing.", "What specifically needs to change, by when, and how is it measured?"],
    ["let's circle back", "A topic is being postponed, sometimes indefinitely.", "When specifically will we revisit this?"],
    ["we're restructuring", "Roles are changing and some may be removed.", "Is my role affected, and when will I know?"],
    ["we value your feedback", "Feedback will be collected; what happens next is unclear.", "What changed as a result of the last round?"],
    ["performance improvement plan", "A formal process that can lead to dismissal, though sometimes it is a genuine chance to improve.", "What are the written targets and the review date?"],
    ["mutually agreed", "Often, the employee was asked to leave and an exit agreement is being offered.", "Can I take time and advice before I sign anything?"],
    ["we're a lean team", "Workloads may be heavy.", "Is this role replacing someone, and what did that person handle?"],
    ["off the record", "Nothing said off the record is protected unless it is in writing.", "Can we put this in an email?"],
  ],
  corporate: [
    ["we're restructuring to position ourselves for sustainable growth", "Roles may be removed to cut costs. Some people may be laid off.", "How many roles are affected, and how will affected people be supported?"],
    ["right-sizing", "Headcount reductions.", "What is the timeline and notice period?"],
    ["streamlining operations", "Cutting steps, teams or roles.", "Which teams are affected?"],
    ["doing more with less", "Budgets or headcount have shrunk while expectations haven't.", "What will be deprioritised?"],
    ["realignment", "A reorganisation. Reporting lines may change.", "Who will I report to afterwards?"],
    ["difficult decisions", "Layoffs or cuts, often announced after they have been made.", "When were these decisions made?"],
    ["we're embracing a return to the office", "Remote or hybrid flexibility may be reduced.", "Is this mandatory, and what happens if I can't comply?"],
    ["we're a startup mentality", "Resources may be tight and roles unclear.", "What are the funding and runway?"],
    ["exciting changes ahead", "Changes are coming that have not yet been announced in detail.", "What is changing, and when will it be communicated?"],
    ["organisational efficiency", "Cost-cutting.", "What is being cut?"],
  ],
  meeting: [
    ["let's take this offline", "The topic will be moved out of the meeting, sometimes to avoid disagreement.", "Can we set a time now?"],
    ["circle back", "Postponed, possibly indefinitely.", "Who will own the follow-up?"],
    ["low-hanging fruit", "The easy wins.", "What is the owner and the date?"],
    ["move the needle", "Make a noticeable difference.", "What does success look like in numbers?"],
    ["synergy", "Two teams working together. Possibly vague.", "What is the concrete deliverable?"],
    ["bandwidth", "Capacity to take on work.", "What would you like me to put down to take this on?"],
    ["quick sync", "A meeting. May not be quick.", "Can we agree an agenda and end time?"],
    ["touch base", "A check-in.", "What decision do you need from me?"],
    ["as per my last email", "Mild frustration that an earlier message wasn't read.", "Can I summarise the open points?"],
    ["alignment", "Agreement, or being told to agree.", "What has been decided already?"],
  ],
};

export function lookupGlossary(kind, input) {
  const list = GLOSSARY[kind] || [];
  const text = String(input || "").toLowerCase();
  const hits = list.filter(([p]) => text.includes(p));
  return hits.slice(0, 5).map(([phrase, meaning, ask]) => ({ phrase, meaning, ask }));
}
