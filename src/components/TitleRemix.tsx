"use client";

import { useState, useTransition } from "react";
import { Shuffle } from "lucide-react";
import { remixTitlesAction } from "@/app/actions/ideas";

/**
 * Inside ResearchIdeaForm (E-IDE-21): asks for two or three titles that keep
 * this video's hook on the Topic chosen in the same form. Picking one fills the
 * form's `title`; "Keep the original" clears it. Without JavaScript the form
 * still works and stores the original title.
 */
export function TitleRemix({ videoId, original }: { videoId: string; original?: string }) {
  const [titles, setTitles] = useState<string[]>([]);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function remix(e: React.MouseEvent<HTMLButtonElement>) {
    const topicId = (e.currentTarget.form?.elements.namedItem("topicId") as HTMLSelectElement | null)?.value ?? "";
    setError("");
    start(async () => {
      const r = await remixTitlesAction(videoId, topicId);
      if ("error" in r) {
        setError(r.error);
        setTitles([]);
        setPicked("");
      } else {
        setTitles(r.titles);
        setPicked(r.titles[0] ?? "");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1" data-title-remix>
      <input type="hidden" name="title" value={picked} />
      <button type="button" onClick={remix} disabled={pending} className="btn sm !text-[11px] inline-flex items-center justify-center gap-1" title="Keep the hook, change the subject to the Topic">
        <Shuffle className="w-3 h-3" /> {pending ? "Remixing…" : "Remix the title for the Topic"}
      </button>
      {error && <p className="text-[11px] m-0" style={{ color: "var(--rose-on)" }} role="alert" data-remix-error>{error}</p>}
      {titles.length > 0 && (
        <fieldset className="flex flex-col gap-0.5 text-[11px] m-0 p-0 border-0" data-remix-choices>
          {titles.map((t) => (
            <label key={t} className="flex items-start gap-1.5"><input type="radio" name="_remix" checked={picked === t} onChange={() => setPicked(t)} /> {t}</label>
          ))}
          <label className="flex items-start gap-1.5 text-[var(--mute)]"><input type="radio" name="_remix" checked={picked === ""} onChange={() => setPicked("")} /> Keep {original ? `“${original}”` : "the original title"}</label>
        </fieldset>
      )}
    </div>
  );
}
