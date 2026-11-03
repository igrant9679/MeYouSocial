import { llm } from "@/lib/llm";
import { placeholderProblem } from "@/lib/studio-ai";
import { cleanTitle } from "@/lib/list-marker";

/**
 * Titles that keep a competitor's hook but change the subject (E-IDE-21).
 * Research turned an outlier into an idea by storing the competitor's own
 * title — their video, not ours. Two or three remixes keep what made it work
 * (the structure, the promise, any number, the tension) and move it onto the
 * Topic; the person picks one or keeps the original.
 */

/** The model's lines as titles: list furniture and wrapping quotes stripped, the original and repeats dropped. */
export function parseRemixes(raw: string, original: string, max = 3): string[] {
  const seen = new Set([original.trim().toLowerCase()]);
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = cleanTitle(line, 200);
    if (!t || t.length < 8) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Remixes of `title` about `subject`, or why there are none (the mock never suggests). */
export async function remixTitles(input: { title: string; subject: string; workspaceId: string }): Promise<{ titles: string[] } | { error: string }> {
  const res = await llm.complete({
    purpose: "ideas.remix",
    model: "",
    system: "You rewrite video titles for a different subject. Keep the hook — the structure, the promise, any number and the tension — and change what the title is about. Reply with exactly three titles, one per line: no numbering, no quotes, nothing else.",
    messages: [{ role: "user", content: `Title: ${input.title}\nNew subject: ${input.subject}` }],
    workspaceId: input.workspaceId,
  });
  const problem = placeholderProblem(res, "no titles were suggested");
  if (problem) return { error: problem };
  const titles = parseRemixes(res.content, input.title);
  return titles.length ? { titles } : { error: "The AI's answer had no usable titles — keep the original or try again." };
}
