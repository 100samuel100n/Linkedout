// Real AI integration for the Title Translator — the one feature in this
// app that directly needed a language model, since "translate a job title
// into corporate hype-speak (or decode it back)" is squarely a text-
// generation task, not something a lookup table could do convincingly.
//
// Calls the configured AI provider (see below). If the key is missing or the
// request fails, the caller gets an honest AiUnavailableError — never a
// made-up answer passed off as a real result.
export class AiUnavailableError extends Error {
  constructor(message = "This feature is temporarily unavailable. Please try again shortly.") {
    super(message);
    this.name = "AiUnavailableError";
    this.status = 503;
  }
}
// ---- Provider layer -------------------------------------------------------
// One function, callModel(), talks to whichever AI provider is configured, so every
// feature below works with any of them. Pick one with AI_PROVIDER:
//   anthropic (default) -> ANTHROPIC_API_KEY            [AI_MODEL optional]
//   openai              -> OPENAI_API_KEY               [OPENAI_BASE_URL, AI_MODEL]
//                          OpenAI-compatible: also works for Groq, OpenRouter, Together,
//                          Mistral, DeepSeek, xAI, Fireworks or a local Ollama server
//                          by changing OPENAI_BASE_URL.
//   gemini              -> GEMINI_API_KEY               [AI_MODEL optional]
const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const DEFAULT_MODELS = { anthropic: "claude-sonnet-4-5", openai: "gpt-4o-mini", gemini: "gemini-2.0-flash" };
const MODEL = process.env.AI_MODEL || DEFAULT_MODELS[PROVIDER] || DEFAULT_MODELS.anthropic;

let lastAiError = null;
// For the admin AI check: tells staff whether a failure is the code, the key/provider, or the host network.
export async function aiDiagnostics() {
  const keyVar = PROVIDER === "openai" ? "OPENAI_API_KEY" : PROVIDER === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  const out = { provider: PROVIDER, model: MODEL, keyVariable: keyVar, keyPresent: isAiConfigured(), baseUrl: PROVIDER === "openai" ? (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1") : null, lastError: lastAiError, live: null, verdict: "" };
  if (!out.keyPresent) { out.verdict = `Hosting/config: ${keyVar} is not set on the server, so every AI feature reports "unavailable". Add it in your host's environment settings and redeploy (or restart).`; return out; }
  const t0 = Date.now();
  try {
    const text = await callModel({ system: "Reply with the single word: ok", user: "ping", maxTokens: 10 });
    out.live = { ok: true, ms: Date.now() - t0, sample: text.slice(0, 40) };
    out.verdict = "AI is working: the key is present and the provider answered. If a feature still fails for someone, check their plan limits and daily AI cap.";
  } catch (e) {
    out.live = { ok: false, ms: Date.now() - t0, error: e.message, upstream: lastAiError };
    const st = lastAiError?.status;
    out.verdict = !lastAiError ? "Network: the server could not reach the AI provider at all (outbound requests blocked, DNS or timeout). Check the host's egress/firewall settings."
      : st === 401 || st === 403 ? "Key problem: the provider rejected the API key (wrong key, revoked, or no access to this model). Replace the key."
      : st === 404 ? `Model problem: the provider doesn't know the model "${MODEL}". Set AI_MODEL to a model your key can use.`
      : st === 429 ? "Quota: the provider is rate-limiting or the account is out of credit. Check billing/limits with the provider."
      : st >= 500 ? "Provider outage: the AI provider returned a server error. Try again shortly."
      : `Provider returned ${st}. See the detail below.`;
  }
  return out;
}

export function isAiConfigured() {
  if (PROVIDER === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (PROVIDER === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Returns the model's text, or throws AiUnavailableError (never a made-up answer).
export async function callModel({ system, user, maxTokens = 300 }) {
  if (!isAiConfigured()) throw new AiUnavailableError();
  let res, text;
  if (PROVIDER === "openai") {
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (res.ok) text = (await res.json()).choices?.[0]?.message?.content;
  } else if (PROVIDER === "gemini") {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
    });
    if (res.ok) text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text).join("");
  } else {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    if (res.ok) text = (await res.json()).content?.find((b) => b.type === "text")?.text;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[ai] ${PROVIDER} error:`, res.status, detail);
    lastAiError = { at: new Date().toISOString(), status: res.status, detail: detail.slice(0, 300) };
    throw new AiUnavailableError();
  }
  text = (text || "").trim();
  if (!text) throw new AiUnavailableError();
  return text;
}

const SYSTEM_PROMPT = `You are the "Title Translator" on LinkedOut, a satirical anti-corporate career-honesty app whose whole thesis is that corporate culture inflates job titles into meaningless hype. You do exactly one job: translate between a REAL, honest job title/description and the HYPED-UP version of it, in whichever direction the user asks.

Rules:
- REAL → HYPE: take a plain, honest title or description and inflate it into the kind of over-the-top, buzzword-laden, achievement-hyperbole title that corporate culture produces (e.g. "answers emails" -> "Strategic Communications Orchestrator driving cross-functional stakeholder alignment").
- HYPE → REAL: take a hyped-up, buzzword-heavy title and decode it back into blunt, plain-English honesty about what the job probably actually is.
- Keep it SHORT: one punchy line, not a paragraph. This is a quick, funny utility, not an essay generator.
- Stay work/career-related. If the input is unrelated to jobs/titles/careers, gently redirect rather than translating nonsense.
- Never mention real, named companies or real people.
- Respond with ONLY the translated line — no preamble, no quotes, no "Here's your translation:".`;

export async function translateTitle(input, direction) {
  if (!isAiConfigured()) throw new AiUnavailableError();

  const directionInstruction = direction === "hype-to-real"
    ? `Decode this hyped-up title/phrase back into blunt real-world honesty: "${input}"`
    : `Inflate this real, honest title/description into corporate hype: "${input}"`;

  const output = await callModel({ system: SYSTEM_PROMPT, user: directionInstruction, maxTokens: 150 });
  return { output, configured: true };
}

// ---------------- Resume Roast ----------------
// Roasts
// the ACTUAL resume text extracted from whatever the person uploaded
// (see lib/resume-parse.js) — not a fixed line set unrelated to what they
// submitted, which is what this endpoint did before this pass.
const ROAST_SYSTEM_PROMPT = `You are the resume-roasting feature on LinkedOut, a satirical anti-corporate career-honesty app. Someone has pasted their real resume text. Your job: roast it — genuinely funny, sharp, a little savage, but never cruel about things they can't control (age, gaps for health/family reasons, employment status, typos from non-native English, disability, etc — redirect humor at corporate-speak, buzzwords, vague achievements, and resume clichés instead). Think "a hilarious friend who's also a ruthless editor," not "a bully."

Rules:
- Return exactly 4 to 6 short roast lines, each one a single punchy sentence (not a paragraph).
- Base every line on something ACTUALLY in the resume text you were given — quote or paraphrase a real buzzword, bullet, or claim from it. Generic roasts that could apply to any resume are a failure.
- Go for maximum comedic effect: exaggeration, mock-serious tone, comparisons, callbacks.
- Never insult protected characteristics, health, disability, age, gaps, or personal circumstances — roast the WRITING and the corporate-speak, not the person.
- Respond with ONLY a JSON array of strings, nothing else — no markdown fences, no preamble. Example: ["line one", "line two", "line three", "line four"]`;

export async function roastResume(resumeText) {
  if (!isAiConfigured()) throw new AiUnavailableError();

  const raw = await callModel({ system: ROAST_SYSTEM_PROMPT, user: resumeText.slice(0, 12000), maxTokens: 500 });
  let lines;
  try { lines = JSON.parse(raw.replace(/^```(json)?/i, "").replace(/```$/, "").trim()); } catch { lines = null; }
  if (!Array.isArray(lines) || lines.length === 0) throw new AiUnavailableError();
  return { lines: lines.slice(0, 6).map(String), configured: true };
}

// ---------------- AI-assisted outreach (OUT PRO) ----------------
const OUTREACH_SYSTEM = `You help someone write the FIRST message (a short message request) to another member of Linkedout, a career-honesty network where people use pseudonyms. Write three different openers: one warm, one direct, one curious.
Rules:
- Each opener must be under the character limit you are given, in first person, plain and human. No buzzwords, no flattery, no pressure.
- Use only the context supplied (the person's public display name and bio, and the sender's goal). Never invent facts about either person, never claim a shared history, never ask for personal or contact details.
- Make it easy to say no. One clear ask or reason at most.
- Respond with ONLY a JSON array of exactly three strings.`;

export async function draftOutreach({ name, bio, goal, maxLen = 300 }) {
  if (!isAiConfigured()) throw new AiUnavailableError();
  const text = await callModel({
    system: OUTREACH_SYSTEM, maxTokens: 600,
    user: `Character limit per opener: ${maxLen}.\nRecipient display name: ${name}\nRecipient public bio: ${bio || "(none)"}\nWhat the sender wants: ${goal || "to introduce themselves and start a conversation"}`,
  });
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?|```$/g, "").trim()); } catch { throw new AiUnavailableError(); }
  const out = (Array.isArray(parsed) ? parsed : []).map((x) => String(x).trim().slice(0, maxLen)).filter(Boolean).slice(0, 3);
  if (!out.length) throw new AiUnavailableError();
  return out;
}

// ---------------- Reality Translators (Corporate / HR / Job posting / Meeting) ----------------
// Always an INTERPRETATION, never a statement of fact. The prompt forbids naming
// real companies or people, and every response carries a disclaimer from the route.
const SPEAK_KINDS = {
  corporate: "corporate announcements and executive statements",
  hr: "HR phrases and messages from People/HR teams",
  job: "job-posting phrases and requirements",
  meeting: "meeting and workplace jargon",
};
export const SPEAK_KIND_KEYS = Object.keys(SPEAK_KINDS);

export async function translateSpeak(kind, input) {
  if (!isAiConfigured()) throw new AiUnavailableError();
  const system = `You are the Reality Translator on LinkedOut, a career-honesty app. The user pastes ${SPEAK_KINDS[kind]}. Say what it PROBABLY means in plain, honest English, dryly and briefly.
Rules:
- This is interpretation, not fact. Use hedged language: "probably", "often means", "can signal". Never state as fact that a specific company is doing something.
- Never name real companies or people. If the text names one, refer to "the company" or "the speaker".
- Give a possible, plain reading AND, when useful, one short thing the listener could ask to find out what is really going on.
- Stay under 90 words. Respond with ONLY a JSON object: {"meaning": string, "ask": string|null, "confidence": "low"|"medium"|"high"}.`;
  const raw = await callModel({ system, user: String(input).slice(0, 800), maxTokens: 300 });
  let o; try { o = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()); } catch { o = null; }
  if (!o || typeof o.meaning !== "string") throw new AiUnavailableError();
  return { meaning: o.meaning.slice(0, 600), ask: typeof o.ask === "string" ? o.ask.slice(0, 240) : null, confidence: ["low", "medium", "high"].includes(o.confidence) ? o.confidence : "low" };
}

// ---------------- AI Story Assistant (OUT+) ----------------
// Helps someone structure what happened. It never adds facts, never accuses,
// and never rewrites the story for them — it only suggests structure.
export async function assistStory(text) {
  if (!isAiConfigured()) throw new AiUnavailableError();
  const system = `You help someone turn a rough account of a workplace experience into a clear Story on LinkedOut. You do NOT add facts, guess names, or make accusations.
Return ONLY a JSON object: {"title": string (max 90 chars, factual, no insults), "told": string|null (what they say they were told, only if clearly stated), "actual": string|null (what they say actually happened, only if clearly stated), "questions": string[] (up to 3 short questions that would make the story clearer, e.g. dates, what changed), "careful": string[] (up to 3 gentle notes where wording states an allegation as fact or names a private person, suggesting "I experienced" phrasing)}.`;
  const raw = await callModel({ system, user: String(text).slice(0, 6000), maxTokens: 700 });
  let o; try { o = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()); } catch { o = null; }
  if (!o || typeof o.title !== "string") throw new AiUnavailableError();
  const arr = (x, n) => (Array.isArray(x) ? x.map(String).map((s) => s.slice(0, 200)).slice(0, n) : []);
  return { title: o.title.slice(0, 120), told: typeof o.told === "string" ? o.told.slice(0, 400) : null, actual: typeof o.actual === "string" ? o.actual.slice(0, 400) : null, questions: arr(o.questions, 3), careful: arr(o.careful, 3) };
}

// ---------------- Company summaries (OUT+ summaries / OUT PRO deep dive & explorer) ----------------
// Summarises ONLY the Stories passed in, with story ids so every statement can link back.
export async function summariseStories({ question, stories, scope }) {
  if (!isAiConfigured()) throw new AiUnavailableError();
  const system = `You summarise what people have reported in Stories on LinkedOut. ${scope === "company" ? "All stories are about one company." : ""}
Rules:
- Use ONLY the supplied stories. Never add outside knowledge. Never state that a company or person did something as fact; say "users report", "N stories mention".
- Describe behaviours and situations, never personal character judgements about named people.
- Mention disagreement between stories when it exists, including positive experiences.
- Each point must cite the story ids that support it.
- Respond with ONLY a JSON object: {"summary": string (max 120 words), "points": [{"text": string, "storyIds": string[]}] (max 6), "limits": string (one sentence on what these stories cannot tell us)}.`;
  const user = `Question: ${question || "What are people saying?"}\n\nStories:\n` + stories.map((s) => `[${s.id}] (${s.format}, ${s.date}${s.who ? ", " + s.who : ""}) ${s.text}`).join("\n\n");
  const raw = await callModel({ system, user: user.slice(0, 14000), maxTokens: 900 });
  let o; try { o = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()); } catch { o = null; }
  if (!o || typeof o.summary !== "string") throw new AiUnavailableError();
  const ids = new Set(stories.map((s) => s.id));
  return {
    summary: o.summary.slice(0, 900),
    points: (Array.isArray(o.points) ? o.points : []).slice(0, 6).map((p) => ({ text: String(p.text || "").slice(0, 300), storyIds: (Array.isArray(p.storyIds) ? p.storyIds : []).filter((id) => ids.has(id)).slice(0, 8) })).filter((p) => p.text),
    limits: typeof o.limits === "string" ? o.limits.slice(0, 240) : "These are individual accounts and have not been independently verified.",
  };
}


// ---------------- Theme classification (paraphrase-proof pattern detection) ----------------
// Keyword rules are explainable but miss paraphrase. When AI is configured we ALSO ask a model
// which fixed themes a Story touches, and store the result with the Story. The model only picks
// from the allowed list; anything else is discarded, and it never sees or returns names.
export async function classifyThemes(text, allowed) {
  if (!isAiConfigured()) return [];
  const system = `You tag workplace stories with themes. Allowed theme keys: ${allowed.join(", ")}.
Return ONLY a JSON array of the keys that the story clearly describes (max 5). If none apply, return []. Never invent keys.`;
  try {
    const raw = await callModel({ system, user: String(text).slice(0, 3000), maxTokens: 80 });
    const arr = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim());
    return Array.isArray(arr) ? [...new Set(arr.filter((k) => allowed.includes(k)))].slice(0, 5) : [];
  } catch { return []; }
}
