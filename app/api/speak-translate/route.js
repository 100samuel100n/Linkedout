import { translateSpeak, SPEAK_KIND_KEYS, isAiConfigured, AiUnavailableError } from "@/lib/ai";
import { GLOSSARY, lookupGlossary, SPEAK_DISCLAIMER } from "@/lib/stories/glossary";
import { viewer, limited, json } from "@/lib/stories/http";

// Reality Translators: corporate / HR / job posting / meeting.
//  - Glossary lookup: free, deterministic, works for everyone (even logged out).
//  - Free-text AI interpretation: OUT+ and up (plan-limited daily).
// Every response says it's an interpretation.
export async function GET() {
  return json({ kinds: SPEAK_KIND_KEYS, aiConfigured: isAiConfigured(), examples: Object.fromEntries(Object.entries(GLOSSARY).map(([k, v]) => [k, v.slice(0, 4).map((x) => x[0])])), disclaimer: SPEAK_DISCLAIMER });
}

export async function POST(request) {
  const b = await request.json().catch(() => ({}));
  const kind = SPEAK_KIND_KEYS.includes(b.kind) ? b.kind : null;
  const input = String(b.input || "").trim();
  if (!kind) return json({ error: "Choose what you want translated." }, 400);
  if (!input) return json({ error: "Paste a phrase first." }, 400);
  if (input.length > 600) return json({ error: "Keep it under 600 characters." }, 400);

  const matches = lookupGlossary(kind, input);
  const out = { kind, matches, disclaimer: SPEAK_DISCLAIMER, ai: null };
  if (!b.ai) return json(out);

  const v = await viewer();
  if (!v.accountId) return json({ ...out, aiNote: "Log in to use AI interpretation." });
  if (v.tier === "basic") return json({ ...out, aiNote: "AI interpretation of any text is part of OUT+. The built-in glossary above is free.", code: "PLAN_REQUIRED" });
  const blocked = await limited(v.accountId, "speak_translate", v.tier); if (blocked) return blocked;
  try { out.ai = await translateSpeak(kind, input); return json(out); }
  catch (e) { if (e instanceof AiUnavailableError) return json({ ...out, aiNote: e.message }); throw e; }
}
