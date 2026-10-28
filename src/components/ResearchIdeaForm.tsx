import { Lightbulb } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { ideaFromResearchAction } from "@/app/actions/ideas";

/**
 * Research's on-ramp to the board ("Topics as the spine", 2026-09-21): one
 * piece of evidence can become an idea in any of the three formats, tagged
 * with the Topic it belongs to. Before this a row could become one thing —
 * an article idea, with the title and nothing else.
 *
 * The Topic is PRE-FILLED from a keyword match (lib/topic-match.ts) and
 * editable; the match is a heuristic and the person has the last word. The
 * idea keeps `sourceVideoId`, so it always points back at what produced it.
 *
 * In a list (`compact`) the choices sit behind one "Make it an idea" button
 * (E-IDE-12) — every row carried a format picker and the whole Topic list.
 * It's a <details>, so it opens without JavaScript.
 *
 * Server component: it hands the server action straight to the form.
 */
export function ResearchIdeaForm({
  videoId,
  topics,
  channels,
  matchedTopicId,
  back,
  compact = false,
}: {
  videoId: string;
  topics: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string }>;
  matchedTopicId: string | null;
  /** Where to land after — the page the form is on. */
  back: string;
  /** One button, for a list row. */
  compact?: boolean;
}) {
  const fields = (
    <>
      <input type="hidden" name="videoId" value={videoId} />
      <input type="hidden" name="back" value={back} />
      <select name="format" className="text-[11px] border border-[var(--line-2)] rounded-md px-1.5 py-1" aria-label="Which kind of idea to make" defaultValue="article">
        <option value="article">Article</option>
        {channels.map((c) => <option key={c.id} value={`video:${c.id}`}>Video{channels.length > 1 ? ` · ${c.name}` : ""}</option>)}
        <option value="social">Social post</option>
      </select>
      {topics.length > 0 && (
        <select name="topicId" className="text-[11px] border border-[var(--line-2)] rounded-md px-1.5 py-1" aria-label="Topic" defaultValue={matchedTopicId ?? ""} title={matchedTopicId ? "Matched by keyword — change it if the match is wrong" : "No Topic matched by keyword"}>
          <option value="">no topic</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === matchedTopicId ? " (matched)" : ""}</option>)}
        </select>
      )}
    </>
  );

  if (compact) {
    return (
      <details className="relative">
        <summary className="btn sm list-none cursor-pointer [&::-webkit-details-marker]:hidden" title="Add it to the Ideas board, linked back to this video">
          <Lightbulb className="w-3 h-3" /> Make it an idea
        </summary>
        <form action={ideaFromResearchAction} className="absolute right-0 top-full mt-1 z-20 card shadow-lg w-60 flex flex-col gap-1.5">
          {fields}
          <SubmitButton className="btn sm" pendingText="Adding…">Add to the board</SubmitButton>
        </form>
      </details>
    );
  }

  return (
    <form action={ideaFromResearchAction} className="flex flex-col gap-1.5">
      {fields}
      <SubmitButton className="btn w-full flex items-center justify-center gap-2" pendingText="Adding…" title="Add it to the Ideas board, linked back to this video">
        <Lightbulb className="w-4 h-4" /> Make it an idea
      </SubmitButton>
    </form>
  );
}
