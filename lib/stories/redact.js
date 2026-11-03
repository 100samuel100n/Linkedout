// Automatic redaction + identity-risk heuristics. Runs on the SERVER on every
// write, so privacy never depends on the client being well behaved.
//
// Redaction removes things that should never be public in a workplace story:
// emails, phone numbers, ID/passport/national-ID-like numbers, bank/card/IBAN
// numbers, passwords and secrets, street addresses. The author is told what was
// removed (counts only — never the removed value).

const RULES = [
  { key: "link",     re: /https?:\/\/\S*(?:token|key|secret|auth|session|invite|signature|sig=)\S*/gi, mask: "[private link removed]" },
  { key: "ip",       re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, mask: "[ip removed]" },
  { key: "handle",   re: /(?<![\w@])@[A-Za-z0-9_.]{3,30}\b/g, mask: "[handle removed]" },
  { key: "email",    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, mask: "[email removed]" },
  { key: "password", re: /\b(?:password|passcode|pwd|pin|secret|token|api[-_ ]?key)\s*(?:is|:|=)\s*\S+/gi, mask: "[secret removed]" },
  { key: "bank",     re: /\b(?:[A-Z]{2}\d{2}[A-Z0-9]{10,30}|\d{13,19})\b/g, mask: "[account number removed]" },
  { key: "phone",    re: /(?<![\w.])(?:\+?\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3}[\s-]?\d{3,4}[\s-]?\d{3,4}(?![\w])/g, mask: "[phone removed]" },
  { key: "id",       re: /\b(?:id|passport|nid|ssn|tax\s?id|kra\s?pin|national\s?id)\s*(?:no\.?|number|#)?\s*[:#-]?\s*[A-Z0-9-]{6,}\b/gi, mask: "[ID removed]" },
  { key: "address",  re: /\b\d{1,5}\s+[A-Za-z0-9 .'-]{2,40}\s(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|close|estate|apartments?|apt\.?)\b[^\n.]{0,40}/gi, mask: "[address removed]" },
];

// Redacts one string. Returns { text, counts }.
export function redactText(input) {
  let text = String(input ?? "");
  const counts = {};
  for (const r of RULES) {
    text = text.replace(r.re, () => { counts[r.key] = (counts[r.key] || 0) + 1; return r.mask; });
  }
  return { text, counts };
}

// Redacts every string in a flat object of fields. Returns { values, counts }.
export function redactFields(obj) {
  const values = {};
  const total = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") { values[k] = v; continue; }
    const { text, counts } = redactText(v);
    values[k] = text;
    for (const [ck, n] of Object.entries(counts)) total[ck] = (total[ck] || 0) + n;
  }
  return { values, counts: total };
}

// Identity-risk heuristic: how easy would it be for someone close to the
// situation to work out who wrote this? It is deliberately a WARNING, never a
// block, and never a reason to force anonymity.
export function identityRisk({ mode, company, department, location, roleTitle, tenure, period, text = "" }) {
  const reasons = [];
  let score = 0;
  const has = (v) => typeof v === "string" && v.trim().length > 0;
  if (has(company)) score += 1;
  if (has(department)) { score += 1; reasons.push("your department"); }
  if (has(location)) { score += 1; reasons.push("your location"); }
  if (has(roleTitle)) { score += 1; reasons.push("your job title"); }
  if (has(tenure)) { score += 1; reasons.push("how long you worked there"); }
  if (has(period) || /\b(20\d\d|last (?:week|month)|yesterday|on (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(text)) { score += 1; reasons.push("a specific date or period"); }
  if (/\b(only|sole|one of (?:two|three)|the (?:one|person) who)\b/i.test(text)) { score += 1; reasons.push("something that makes you the only person it could be"); }
  if (/\b(my (?:manager|boss|director|vp|ceo|supervisor)(?: (?:\w+ ){0,2}[A-Z][a-z]+)?)\b/.test(text) && /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text)) { score += 1; reasons.push("a named person"); }
  const level = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  const unique = [...new Set(reasons)];
  const shouldConsiderAnon = mode !== "anon" && level !== "low";
  return {
    level,
    reasons: unique,
    suggestAnonymous: shouldConsiderAnon,
    message: level === "low" ? null
      : `This story mentions ${unique.slice(0, 4).join(", ") || "several specific details"}. Someone familiar with the situation may be able to work out who you are.${shouldConsiderAnon ? " Consider posting anonymously — it's your choice." : ""}`,
  };
}

// ---- Named private individuals -------------------------------------------------------------
// A heuristic, on purpose: names are hard. It looks for the patterns people use when they name
// someone ("my manager Jane Mwangi", "Mr Otieno", "John Smith told me"). It never blocks —
// it only asks the author to describe behaviour and role instead, and offers a one-tap swap.
const ci = (w) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const ROLE = ["manager","boss","supervisor","director","ceo","cto","coo","cfo","vp","team lead","lead","recruiter","hr manager","hr lead","hr officer","hr","colleague","coworker","co-worker","teammate","founder","owner"].map(ci).join("|");
const PRE = ["my","our","the","a","his","her"].map(ci).join("|");
const NOT_NAMES = new Set(["I","The","This","That","They","We","He","She","It","My","Our","Your","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday","January","February","March","April","May","June","July","August","September","October","November","December","Human Resources","Slack","Zoom","Teams","Google","Linux","Kenya","Nairobi","Remote","LinkedIn","LinkedOut","Linked Out"]);
export function namedPeople(text, { companyName } = {}) {
  const t = String(text || ""); const found = new Set();
  const company = (companyName || "").toLowerCase();
  const add = (n) => { const x = n.trim(); if (x && !NOT_NAMES.has(x) && x.toLowerCase() !== company && !company.includes(x.toLowerCase())) found.add(x); };
  for (const m of t.matchAll(new RegExp(`\\b(?:${PRE})\\s+(?:${ROLE})\\s*,?\\s+(?:[Nn]amed\\s+|[Cc]alled\\s+)?([A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]{2,}){0,2})`, "g"))) add(m[1]);
  for (const m of t.matchAll(/\b(?:Mr|Mrs|Ms|Miss|Dr|Prof|Eng|Sir)\.?\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g)) add(m[1]);
  for (const m of t.matchAll(/(?<![.!?]\s)(?<!^)\b([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,})\b(?=\s+(?:said|told|asked|called|sent|emailed|messaged|shouted|yelled|fired|laid|promised|threatened|refused|ignored|approved|rejected|wrote|texted|touched|accused))/g)) add(m[1]);
  return [...found].slice(0, 12);
}
export function swapNames(text, names, replacement = "a colleague") {
  let out = String(text || "");
  for (const n of names) out = out.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), replacement);
  return out;
}
