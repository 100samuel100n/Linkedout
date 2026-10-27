import { assistStory, AiUnavailableError, isAiConfigured } from "@/lib/ai";
import { requireViewer, limited, json, planRequired } from "@/lib/stories/http";

export async function POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  if (!v.perks.aiStoryAssistant) return planRequired("The AI Story Assistant");
  const blocked = await limited(v.accountId, "story_assist", v.tier); if (blocked) return blocked;
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || "").trim();
  if (text.length < 40) return json({ error: "Write a few sentences first, then ask for help structuring them." }, 400);
  if (!isAiConfigured()) return json({ error: "This feature is temporarily unavailable. Please try again shortly." }, 503);
  try { return json(await assistStory(text)); } catch (e) { if (e instanceof AiUnavailableError) return json({ error: e.message }, 503); throw e; }
}
