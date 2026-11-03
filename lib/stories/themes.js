// Pattern detection, deliberately boring and explainable: a fixed dictionary of
// workplace themes matched against story text. No model, no score a company can
// argue with — every pattern links back to the stories that produced it.
//
// Wording rule (legal + ethical): patterns are phrased as "N user reports
// mention X within the last D days". They never say a company IS anything.

export const THEMES = [
  { key: "layoffs",       label: "layoffs",                         re: /\b(laid[- ]off|lay[- ]?offs?|redundanc(?:y|ies)|redundant|let (?:me|us|them|\w+) go|let go|downsiz\w*|retrench\w*|restructur\w*|right[- ]?siz\w*|cut (?:\d+ ?%|the team|headcount)|position (?:was )?eliminated|role (?:was )?eliminated|termination (?:email|call)|badge (?:was )?(?:deactivated|disabled)|locked out of (?:slack|email|my laptop))/i },
  { key: "rto",           label: "return-to-office changes",        re: /\b(return[- ]to[- ]office|rto|back to (?:the )?office|office attendance|mandatory (?:office|in[- ]person|onsite|on-site)|(?:\d|four|three|five) days (?:a week )?in (?:the )?office|remote work (?:ended|removed|was cancelled)|badge (?:swipe|tracking)|hybrid (?:policy|mandate))/i },
  { key: "hiring_freeze", label: "hiring freezes",                  re: /\b(hiring freeze|freeze on hiring|frozen headcount|no (?:new )?hires|backfill\w*|position (?:on hold|frozen)|requisitions? (?:closed|cancelled|frozen))/i },
  { key: "unpaid_ot",     label: "unpaid overtime",                 re: /\b(unpaid overtime|unpaid hours|(?:work|worked|working) (?:late|weekends?|nights|holidays|\d{2}[- ]hour)|2 ?am|after[- ]hours|always on|on[- ]call|weekend work|expected to reply (?:at|after)|replies? (?:at|after) midnight|no overtime pay|toil (?:denied|refused)|never (?:switch|log) off)/i },
  { key: "intimidation",  label: "manager intimidation",            re: /\b(intimidat\w*|threat(?:en|s)\w*|bull(?:y|ied|ying)|humiliat\w*|scream\w*|yell\w*|shout\w*|micromanag\w*|belittl\w*|gaslight\w*|public(?:ly)? (?:berat|shame)\w*|retaliat\w*|tantrum|abusive (?:boss|manager)|hostile (?:environment|manager))/i },
  { key: "unclear",       label: "unclear expectations",            re: /\b(unclear (?:expectations|goals|role|ownership)|moving goal ?posts?|no direction|(?:constantly )?(?:changing|shifting) priorities|nobody knew (?:what|who)|conflicting (?:instructions|priorities)|no (?:job description|onboarding|clear (?:kpis|targets)))/i },
  { key: "unpaid_wages",  label: "late or unpaid wages",            re: /\b(unpaid (?:wages|salary|salaries)|late (?:pay|salary|salaries|wages|payroll)|delayed (?:pay|salary|salaries|payroll)|salary delays?|(?:didn.t|did not|haven.t|have not|wasn.t|was not|weren.t|were not) (?:been )?paid|not paid|withheld (?:pay|salary|wages)|payroll (?:was )?(?:late|missed|bounced)|months? without (?:pay|salary)|owed (?:me )?(?:wages|salary|pay))/i },
  { key: "salary_change", label: "pay changed after agreement",     re: /\b(chang(?:ed|ing) (?:my |the )?(?:salary|offer|pay|compensation)|lower(?:ed)? (?:the )?(?:offer|salary|pay)|pay cut|salary cut|reduced (?:my )?(?:salary|pay)|offer (?:was )?(?:withdrawn|rescinded|reduced|revoked)|bait and switch|final (?:offer|pay) (?:was )?(?:lower|less)|less than (?:the )?(?:advertised|posted|promised))/i },
  { key: "ghosting",      label: "interview ghosting",              re: /\b(ghost(?:ed|ing)|never heard back|no (?:response|reply|feedback|update) (?:after|since)|radio silence|went silent|stopped (?:replying|responding)|left (?:me )?(?:hanging|on read)|silence (?:after|since))/i },
  { key: "burnout",       label: "burnout",                         re: /\b(burn(?:ed|t)?[- ]?out|exhaust\w*|overwork\w*|no time off|couldn.t switch off|breakdown|panic attacks?|stress leave|can.t (?:sleep|cope)|running on empty|drained)/i },
  { key: "discrimination",label: "discrimination concerns",         re: /\b(discriminat\w*|racis\w*|sexis\w*|ageis\w*|homophob\w*|xenophob\w*|tribal\w*|biased? against|passed over because|pregnan\w+ .{0,40}(?:fired|laid|demoted|passed over)|(?:because (?:of )?my|due to my) (?:gender|race|age|religion|disability|accent|tribe|pregnancy))/i },
  { key: "harassment",    label: "harassment concerns",             re: /\b(harass\w*|inappropriate (?:comments?|touch\w*|messages?|jokes?|behaviou?r)|unwanted (?:advances|attention|touch\w*)|sexual (?:comments?|advances|favou?rs)|made (?:me|us) uncomfortable|creepy)/i },
  { key: "broken_promise",label: "broken promises",                 re: /\b(promised|was told .{0,60}(?:but|then|later)|they said .{0,60}(?:but|then)|never (?:happened|materiali[sz]ed|came)|promotion (?:never|didn.t|was (?:denied|delayed))|equity (?:never|was (?:never|not))|verbal (?:agreement|promise)|reneged|went back on)/i },
  { key: "positive",      label: "positive experiences",            re: /\b(great (?:manager|team|culture|boss|place)|supportive|paid (?:me )?(?:full )?severance|transparent|flexib\w+|mentor\w*|fair (?:pay|promotion|treatment)|did the right thing|handled (?:it|this) (?:well|with care)|treated (?:me|us) (?:well|with respect)|best (?:manager|team|job)|generous (?:severance|notice)|gave (?:me )?\d+ (?:days|months|weeks).{0,10} notice)/i },
];

export const THEME_BY_KEY = Object.fromEntries(THEMES.map((t) => [t.key, t]));

export function themesIn(text) {
  const s = String(text || "");
  return THEMES.filter((t) => t.re.test(s)).map((t) => t.key);
}

// Interview questions generated from what people actually reported.
export const ASK_BEFORE_JOINING = {
  layoffs: "Have there been layoffs or restructures in the last 12 months, and how were they handled?",
  rto: "What is the current office-attendance policy, and has it changed recently?",
  hiring_freeze: "Is this role a backfill or a new position, and is hiring currently frozen anywhere?",
  unpaid_ot: "How often are people expected to work outside normal hours, including weekends or on-call?",
  intimidation: "How does the team handle disagreement with a manager? Can I speak with someone who left the team?",
  unclear: "How are expectations and priorities set, and how often do they change?",
  unpaid_wages: "How are salaries paid and on what day? Has payroll ever been late?",
  salary_change: "Can the compensation in the offer be confirmed in writing before I resign from my current job?",
  ghosting: "What is the hiring timeline and who will update me at each stage?",
  burnout: "What does a normal week look like, and how is workload managed when someone is out?",
  discrimination: "What is the process for raising a complaint, and who handles it outside my reporting line?",
  harassment: "What is the process for raising a complaint, and who handles it outside my reporting line?",
  broken_promise: "Can the promises made during hiring (title, scope, promotion path) be included in the offer letter?",
};

// Plain-language pattern wording. `days` is the look-back window.
export function patternLine(themeKey, n, days) {
  const t = THEME_BY_KEY[themeKey];
  if (!t) return null;
  return `${n} user report${n === 1 ? "" : "s"} mention ${t.label} within the last ${days} days.`;
}

// Claim topics → themes whose reports bear on the claim (Truth Gap).
export const CLAIM_TOPICS = {
  "Work-life balance": { negative: ["unpaid_ot", "burnout"], label: "work-life balance" },
  "Flexibility / remote work": { negative: ["rto"], label: "flexibility" },
  "Stability / growth": { negative: ["layoffs", "hiring_freeze"], label: "stability" },
  "Pay and fairness": { negative: ["unpaid_wages", "salary_change"], label: "pay" },
  "Culture / management": { negative: ["intimidation", "unclear", "discrimination", "harassment"], label: "culture" },
  "Promotions / career growth": { negative: ["broken_promise"], label: "career growth" },
};

// Themes for a stored story row: the AI-classified/keyword themes saved at write time, unioned
// with a fresh keyword pass (so dictionary improvements apply to old stories without a backfill).
export function rowThemes(r) {
  let saved = [];
  try { saved = JSON.parse(r.themes || "[]"); } catch { /* ignore */ }
  const fresh = themesIn(`${r.title || ""} ${r.body || ""} ${r.told || ""} ${r.actual || ""} ${r.impact || ""}`);
  return [...new Set([...saved, ...fresh])];
}
export const THEME_KEYS = THEMES.map((t) => t.key);
