import { contentDb } from "../content/db.js";
import { resolveAliasAccountId, createNotification } from "../identity/service.js";

// Gentle, milestone-only notifications for the author: 1st, 5th, 10th, 25th, 50th, 100th person.
const MILESTONES = new Set([1, 5, 10, 25, 50, 100, 250, 500]);
export async function notifyMeTooMilestone(storyId, total) {
  if (!MILESTONES.has(total)) return;
  const s = await contentDb.prepare("SELECT anonymous_id, title FROM stories WHERE id = ?").get(storyId);
  if (!s?.anonymous_id) return;
  const accountId = await resolveAliasAccountId(s.anonymous_id);
  if (!accountId) return;
  const msg = total === 1 ? "Someone says this happened to them too." : `${total} people say this happened to them too.`;
  await createNotification(accountId, "story", msg, null);
}
