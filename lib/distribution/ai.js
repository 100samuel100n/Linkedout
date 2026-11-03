// Admin-controlled AI help for the integrity system. Hard rules:
//  * Off by default; switched on/off in Admin -> Update & Integrity Policy ("AI assistant").
//  * Advisory only: it writes notes and drafts. It never revokes, blocks, reports or changes anything itself.
//  * Data minimisation: it only sees what is passed here (counts, reason strings, domain names, signals). No emails, names,
//    messages, tokens or raw IP addresses are ever sent to the model provider.
//  * Output is stored on the row as "AI draft" so a human sees what was suggested and who approved the action.
import { callModel, isAiConfigured, AiUnavailableError } from "@/lib/ai";
import { settings, bad } from "./db.js";

async function guard() {
  const s = await settings();
  if (s.ai_enabled !== "1") throw bad("The AI assistant is switched off. Turn it on under Update & Integrity Policy.", 409);
  if (!isAiConfigured()) throw bad("AI is not configured on the server (see AI Health Check).", 409);
}
const SYSTEM = "You are a careful security analyst assistant for a social app that distributes its Android app directly from its own website. Be factual and concise. Do not speculate beyond the evidence. Never accuse any company or government of anything. You only advise; a human decides and acts. Use plain language. Maximum 120 words.";
const run = async (user, maxTokens = 350) => { await guard(); try { return `AI draft (review before use): ` + (await callModel({ system: SYSTEM, user, maxTokens })).trim(); } catch (e) { if (e instanceof AiUnavailableError) throw bad("AI is unavailable right now.", 503); throw e; } };

export const triageDetection = (summary) => run(`Triage this app-integrity detection. Say (1) what it most likely is, (2) how confident you are and why, (3) the safest next step from this list: ignore, watch, revoke the install, raise the minimum version, switch a feature off for a version, report a look-alike. Detection:\n${JSON.stringify(summary).slice(0, 1500)}`);
export const assessLookalike = (row) => run(`Assess whether this site is probably impersonating LinkedOut or is unrelated/harmless. Evidence (signals we observed, not accusations): ${JSON.stringify({ target: row.target, kind: row.kind, similarity: row.similarity, http: row.http_status, evidence: row.evidence }).slice(0, 1500)}. Answer: likely impersonation / unclear / likely unrelated, then one sentence of reasoning, then what a person should check by hand.`);
export const polishReport = (draft) => run(`Improve this abuse report so it is short, polite and strictly factual. Keep every fact; add none. Return only the report text.\n\n${String(draft).slice(0, 2500)}`, 600);
export const summariseWeek = (stats) => run(`Write a 5-line plain-language status summary for the team from these distribution/integrity numbers, then list at most 3 things to look at.\n${JSON.stringify(stats).slice(0, 1500)}`);
