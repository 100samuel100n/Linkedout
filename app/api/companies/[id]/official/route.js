import { contentDb, formatRelativeTime } from "@/lib/content/db";
import { viewer, requireViewer, json, fail } from "@/lib/stories/http";
import { StoryError } from "@/lib/stories/service";
import { redactFields } from "@/lib/stories/redact";
import { FAQ_TOPICS, publicSignals } from "@/lib/stories/company-intel";
import { PROFILE_SECTIONS, FACT_KEYS } from "@/lib/stories/company-suite";
import { notifyRoles } from "@/lib/stories/company-alerts";
import { levelOf } from "@/lib/business-features";
import { planOf } from "@/lib/stories/business";

// Public, read-mostly. Everything here is COMPANY-AUTHORED and labelled that way by the UI ("Company says"),
// kept apart from anonymous stories ("People report"). Verified companies only.
const day = () => new Date().toISOString().slice(0, 10);
export async function GET(request, { params }) {
  const { id } = await params; const v = await viewer();
  try {
    const c = await contentDb.prepare("SELECT id, name, industry, owner_key, verification, status FROM companies WHERE id = ?").get(id);
    if (!c || c.status !== "active") return json({ error: "Company not found." }, 404);
    const isRep = !!v.key && (c.owner_key === v.key || !!(await contentDb.prepare("SELECT 1 x FROM company_reps WHERE company_id = ? AND anon_key = ?").get(id, v.key)));
    if (!isRep) await contentDb.prepare("INSERT INTO company_page_views (company_id, day, n) VALUES (?,?,1) ON CONFLICT (company_id, day) DO UPDATE SET n = company_page_views.n + 1").run(id, day()).catch(() => {});
    if (c.verification !== "verified") return json({ verified: false });
    const plan = (await planOf(id)).plan;
    const [faq, ann, qs, prof, show, mine] = await Promise.all([
      contentDb.prepare("SELECT topic, answer FROM company_faq WHERE company_id = ?").all(id),
      contentDb.prepare("SELECT id, title, body, kind, created_at FROM company_announcements WHERE company_id = ? ORDER BY created_at DESC LIMIT 10").all(id),
      contentDb.prepare("SELECT id, question, answer, answered_at FROM company_questions WHERE company_id = ? AND status = 'answered' ORDER BY answered_at DESC LIMIT 20").all(id),
      contentDb.prepare("SELECT section, body, verified FROM company_profile WHERE company_id = ?").all(id),
      levelOf(plan, "showcase") ? contentDb.prepare("SELECT id, kind, title, url FROM company_showcase WHERE company_id = ? ORDER BY created_at DESC LIMIT 40").all(id) : [],
      v.key ? contentDb.prepare("SELECT 1 x FROM company_interest WHERE company_id = ? AND anon_key = ?").get(id, v.key) : null,
    ]);
    const P = Object.fromEntries(prof.map((p) => [p.section, p]));
    return json({ verified: true, canAsk: !!v.key, talentInterest: levelOf(plan, "talent_interest") ? { enabled: true, mine: !!mine } : { enabled: false },
      signals: await publicSignals(c),
      faq: FAQ_TOPICS.map(([k, label]) => ({ label, answer: faq.find((f) => f.topic === k)?.answer })).filter((f) => f.answer),
      announcements: ann.map((a) => ({ id: a.id, title: a.title, body: a.body, kind: a.kind, ago: formatRelativeTime(a.created_at) })),
      questions: qs.map((q) => ({ id: q.id, question: q.question, answer: q.answer, ago: formatRelativeTime(q.answered_at) })),
      sections: PROFILE_SECTIONS.map(([k, label]) => ({ label, body: P[k]?.body })).filter((s) => s.body),
      facts: FACT_KEYS.map(([k, label]) => ({ label, value: P[`fact:${k}`]?.body, verified: !!P[`fact:${k}`]?.verified })).filter((f) => f.value),
      showcase: show });
  } catch (e) { return fail(e); }
}

// Candidates ask a question (anonymous to the company; only the alias key is stored, never shown) or say they're interested.
export async function POST(request, { params }) {
  const v = await requireViewer(); if (v.error) return v.error;
  const { id } = await params; const b = await request.json().catch(() => ({}));
  try {
    const c = await contentDb.prepare("SELECT id, name, verification, status FROM companies WHERE id = ?").get(id);
    if (!c || c.status !== "active" || c.verification !== "verified") throw new StoryError("Company not found.", 404, "NOT_FOUND");
    if (b.action === "interest") {
      const plan = (await planOf(id)).plan; if (!levelOf(plan, "talent_interest")) throw new StoryError("This company hasn't turned on talent interest.", 400, "NOT_AVAILABLE");
      const had = await contentDb.prepare("SELECT 1 x FROM company_interest WHERE company_id = ? AND anon_key = ?").get(id, v.key);
      if (had) await contentDb.prepare("DELETE FROM company_interest WHERE company_id = ? AND anon_key = ?").run(id, v.key);
      else await contentDb.prepare("INSERT INTO company_interest (company_id, anon_key, created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(id, v.key, new Date().toISOString());
      return json({ mine: !had });
    }
    if (b.action === "ask") {
      const text = redactFields({ q: String(b.question || "").trim().slice(0, 400) }).values.q;
      if (text.length < 10) throw new StoryError("Ask a full question, at least a sentence.");
      const n = Number((await contentDb.prepare("SELECT COUNT(*) n FROM company_questions WHERE asker_key = ? AND created_at > ?").get(v.key, new Date(Date.now() - 864e5).toISOString())).n);
      if (n >= 5) throw new StoryError("That's five questions today. Try again tomorrow.", 429, "RATE_LIMITED");
      await contentDb.prepare("INSERT INTO company_questions (id, company_id, asker_key, question, status, created_at) VALUES (?,?,?,?,'open',?)").run(crypto.randomUUID(), id, v.key, text, new Date().toISOString());
      await notifyRoles(id, ["owner", "admin", "communications"], `A candidate asked ${c.name} a question. Answer it from your dashboard.`).catch(() => {});
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return fail(e); }
}
