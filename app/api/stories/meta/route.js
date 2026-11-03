import { STORY_CATEGORIES, STORY_FORMATS, WHO_OPTIONS, WANT_OPTIONS, OUTCOMES, LEAVE_REASONS, GHOST_STAGES, EVIDENCE_LEVELS, EVIDENCE_KINDS } from "@/lib/stories/constants";
import { CLAIM_TOPICS } from "@/lib/stories/themes";
import { json } from "@/lib/stories/http";
// Vocabulary for clients that don't bundle lib/stories/constants.js (the native app).
export async function GET() {
  return json({ categories: STORY_CATEGORIES, formats: STORY_FORMATS, who: WHO_OPTIONS, wants: WANT_OPTIONS, outcomes: OUTCOMES, leaveReasons: LEAVE_REASONS, ghostStages: GHOST_STAGES, evidenceLevels: EVIDENCE_LEVELS, evidenceKinds: EVIDENCE_KINDS, claimTopics: Object.keys(CLAIM_TOPICS) });
}
