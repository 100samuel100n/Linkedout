import { GLOSSARY } from "./glossary.js";
const KIND_LABEL = { job: "job posting", hr: "HR", corporate: "corporate", meeting: "meeting" };
export const kindLabel = (k) => KIND_LABEL[k] || k;
export const phraseSlug = (kind, phrase) => `${kind}-${String(phrase).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
export function findPhrase(slug) {
  for (const [kind, list] of Object.entries(GLOSSARY)) for (const [phrase, meaning, ask] of list) if (phraseSlug(kind, phrase) === slug) return { kind, phrase, meaning, ask };
  return null;
}
export function relatedPhrases(kind, phrase, n = 4) {
  return (GLOSSARY[kind] || []).filter(([p]) => p !== phrase).slice(0, n).map(([p]) => ({ phrase: p, slug: phraseSlug(kind, p) }));
}
