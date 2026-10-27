import { contentDb } from "@/lib/content/db";
import { companyReality, normCompany } from "@/lib/stories/service";
import { summariseStories, AiUnavailableError, isAiConfigured } from "@/lib/ai";
import { requireViewer, limited, json, planRequired } from "@/lib/stories/http";

// One endpoint, three plan-gated modes (all summarise ONLY real Stories, with links back):
//   summary   (OUT+)    "What people are saying" for a company
//   deep-dive (OUT PRO) company deep dive: structured reality + AI synthesis
//   explorer  (OUT PRO) Pattern Explorer: a free-form question over a company's stories
const DAY = 864e5;
export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  const b = await request.json().catch(() => ({}));
  const mode = ["summary", "deep-dive", "explorer"].includes(b.mode) ? b.mode : "summary";
  if (mode === "summary" && !v.perks.summaries) return planRequired("Story summaries");
  if (mode !== "summary" && !v.perks.deepDive) return planRequired("Company Deep Dive and Pattern Explorer", "OUT PRO");
  const company = await contentDb.prepare("SELECT id, name FROM companies WHERE id = ? AND status = 'active'").get(b.companyId);
  if (!company) return json({ error: "Choose a company first." }, 400);
  const blocked = await limited(v.accountId, mode === "summary" ? "story_summary" : "deep_dive", v.tier); if (blocked) return blocked;

  const sinceDays = Math.min(730, Math.max(30, Number(b.days) || (mode === "summary" ? 180 : 365)));
  const rows = await contentDb.prepare(
    `SELECT id, format, title, body, told, actual, who, created_at FROM stories
     WHERE status='published' AND (company_id = ? OR company_key = ?) AND created_at > ? ORDER BY created_at DESC LIMIT 40`
  ).all(company.id, normCompany(company.name), new Date(Date.now() - sinceDays * DAY).toISOString());

  const structured = mode === "deep-dive" ? await companyReality(company.id, { viewerKey: v.key, tier: v.tier }) : null;
  if (rows.length < 3) return json({ company: company.name, storyCount: rows.length, structured, summary: null, note: "There aren't enough Stories about this company yet to summarise. Be the first to share, or check back soon." });
  if (!isAiConfigured()) return json({ company: company.name, storyCount: rows.length, structured, summary: null, note: "AI summaries are temporarily unavailable. The structured data is still shown." });

  const stories = rows.map((r) => ({ id: r.id, format: r.format, date: r.created_at.slice(0, 10), who: r.who, text: [r.title, r.body, r.told && `Told: ${r.told}`, r.actual && `Actual: ${r.actual}`].filter(Boolean).join(" ").slice(0, 700) }));
  try {
    const summary = await summariseStories({ question: mode === "explorer" ? String(b.question || "").slice(0, 300) : null, stories, scope: "company" });
    return json({ company: company.name, storyCount: rows.length, windowDays: sinceDays, structured, summary });
  } catch (e) {
    if (e instanceof AiUnavailableError) return json({ company: company.name, storyCount: rows.length, structured, summary: null, note: e.message });
    throw e;
  }
}
