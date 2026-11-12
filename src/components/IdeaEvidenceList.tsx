import { parseEvidence } from "@/lib/idea-evidence";
import { sourceLabel } from "@/lib/reach";

/**
 * "Drawn from" on an idea's page (Reach): the discussions discovery cited, each
 * tagged with where it came from — Reddit, the web, or the social platform
 * (Threads, LinkedIn …). Renders nothing when the idea has no live sources.
 */
export function IdeaEvidenceList({ raw }: { raw: string | null | undefined }) {
  const evidence = parseEvidence(raw);
  if (!evidence.length) return null;
  return (
    <ul className="m-0 p-0 flex flex-col gap-0.5" data-idea-evidence>
      {evidence.map((e) => (
        <li key={e.url} className="list-none">
          <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)] mr-1">{sourceLabel(e.source, e.url)}</span>
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline break-all">{e.title || e.url}</a>
        </li>
      ))}
    </ul>
  );
}
