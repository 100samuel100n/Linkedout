import { pausable } from "@/lib/flags";
import { requireViewer, json, fail } from "@/lib/stories/http";
import { extractResumeText } from "@/lib/resume-parse";
import { StoryError } from "@/lib/stories/service";
// Turn an uploaded resume (PDF or Word) into text for an application. Nothing is stored here: the text goes back to the browser,
// and only what the person then submits with an application is kept.
async function _POST(request) {
  const v = await requireViewer(); if (v.error) return v.error;
  try {
    const f = (await request.formData()).get("file");
    if (!f || typeof f === "string") throw new StoryError("Choose a file.");
    if (f.size > 5 * 1024 * 1024) throw new StoryError("Resumes can be up to 5 MB.");
    const text = String((await extractResumeText(f)) || "").trim();
    if (text.length < 50) throw new StoryError("We couldn't read text from that file. Try a text-based PDF or Word file, or paste your resume.");
    return json({ text: text.slice(0, 20000), chars: text.length });
  } catch (e) { return fail(e); }
}

export const POST = pausable(_POST);
