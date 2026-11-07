import { FileSearch, Star, Trash2, Lightbulb } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { requireChannel } from "@/lib/channel";
import { db } from "@/lib/db";
import { deepResearchAction, starResearchAction, deleteResearchAction, ideasFromReportAction, rereadResearchAction } from "@/app/actions/research";
import { AiAssist } from "@/components/AiAssist";
import { canEdit } from "@/lib/acl";
import { MarkdownMessage } from "@/components/MarkdownMessage";
import { ProvenanceChip } from "@/components/ProvenanceChip";
import { readJson } from "@/lib/db/json";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { AutoRefresh } from "@/components/AutoRefresh";
import { storage } from "@/lib/storage";
import { formatBytes } from "@/lib/documents/kinds";

// MU — Research library. deep tool,..05 manage sources,
// starred research persists across all scripts.

/** What the page itself shows of a long document: the page shouldn't weigh a megabyte. */
const SHOWN_CHARS = 50_000;

export default async function ChannelResearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { id } = await params;
  const { focus } = await searchParams;
  const { workspace, membership } = await requireChannel(id);
  // Viewers read the library; running, starring, deleting and making ideas are an editor's.
  const editor = canEdit(membership.role);
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");

  // The list without the text: a document can be a million characters now (E-ENG-13).
  const sources = await db.researchSource.findMany({
    where: { channelId: id, scriptId: null },
    orderBy: [{ starred: "desc" }, { createdAt: "desc" }],
    take: 60,
    select: { id: true, title: true, ref: true, starred: true, readState: true },
  });
  const focusedId = focus && sources.some((s) => s.id === focus) ? focus : sources[0]?.id;
  const focused = focusedId ? await db.researchSource.findUnique({ where: { id: focusedId } }) : null;
  const isFile = !!focused && ["pdf", "word", "text", "image"].includes(focused.kind);
  const text = focused?.content ?? null;
  // The web results a report was given (E-IDE-15) — http(s) links only, as stored.
  const storedSources = readJson<unknown>(focused?.webSources ?? null, []);
  const webSources = (Array.isArray(storedSources) ? storedSources as { title?: unknown; url?: unknown }[] : [])
    .filter((w): w is { title?: string; url: string } => typeof w?.url === "string" && /^https?:\/\//i.test(w.url));

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-10 h-10 rounded-xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
          <FileSearch className="w-5 h-5" strokeWidth={2.25} />
        </span>
        <div>
          <h2 className="font-mono font-bold text-lg leading-tight">Research</h2>
          <p className="text-xs text-[var(--mute)]">Deep multi-source research synthesized into saved reports. Star items to persist them across every script.</p>
        </div>
      </div>

      {/* Deep research form */}
      {!editor ? (
        <p className="text-xs text-[var(--mute)] mb-5" data-read-only>Running research is for editors — the saved reports are below.</p>
      ) : (
      <form action={deepResearchAction} className="card mb-5">
        <h3 className="font-mono font-bold text-sm mb-3 flex items-center gap-2"><FileSearch className="w-4 h-4" style={{ color: "var(--blue)" }} /> New deep research</h3>
        <input type="hidden" name="channelId" value={id} />
        <label className="flex flex-col gap-1 mb-2">
          <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Question / topic</span>
          <textarea name="question" required rows={2} placeholder="What's the latest evidence on cold exposure and recovery?" className="border border-[var(--line-2)] rounded-lg p-2 text-sm" />
        </label>
        <AiAssist field="research.notes" target="question" channelId={id} label="Suggest a question" />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-micro font-mono uppercase tracking-wider text-[var(--mute)]">Depth (word budget)</span>
            <select name="depth" defaultValue="intermediate" className="border border-[var(--line-2)] rounded-lg p-2 text-sm">
              <option value="basic">Basic — 5k</option>
              <option value="intermediate">Intermediate — 15k</option>
              <option value="comprehensive">Comprehensive — 45k</option>
              <option value="exhaustive">Exhaustive — 90k</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs ml-2">
            <input type="checkbox" name="includeCompetitors" value="1" defaultChecked />
            Include competitor video titles for niche context
          </label>
          <span className="flex-1" />
          <SubmitButton className="btn primary">Run deep research</SubmitButton>
        </div>
      </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Library */}
        <aside className="card p-3 h-fit">
          <h3 className="font-mono text-xs uppercase tracking-wider text-[var(--mute)] mb-2">Library ({sources.length})</h3>
          {sources.length === 0 && <p className="text-xs text-[var(--mute)] py-2 text-center">No research yet.</p>}
          <ul className="m-0 p-0 flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.id}>
                <a href={`/channels/${id}/research?focus=${s.id}`} className={"flex items-start gap-2 px-2 py-1.5 rounded-md text-xs transition " + (focused?.id === s.id ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--slate)] hover:bg-[var(--zebra)]")}>
                  {s.starred && <Star className="w-3 h-3 flex-shrink-0 mt-0.5" fill="currentColor" style={{ color: "var(--amber)" }} />}
                  <span className="flex-1 truncate font-semibold">{s.title ?? s.ref}</span>
                </a>
              </li>
            ))}
          </ul>
        </aside>

        {/* Focused detail */}
        <main>
          {focused ? (
            <article className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-micro uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{focused.kind}</span>
                <h2 className="font-mono font-bold text-lg flex-1">{focused.title ?? focused.ref}</h2>
                {editor && (<>
                <form action={starResearchAction}>
                  <input type="hidden" name="id" value={focused.id} />
                  <button type="submit" title="Toggle starred"><Star className="w-4 h-4" fill={focused.starred ? "currentColor" : "none"} style={{ color: focused.starred ? "var(--amber)" : "var(--mute)" }} /></button>
                </form>
                <form action={deleteResearchAction}>
                  <input type="hidden" name="id" value={focused.id} />
                  <input type="hidden" name="channelId" value={id} />
                  <button type="submit" className="btn sm" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </form>
                </>)}
              </div>
              <div className="text-xs text-[var(--mute)] mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  {formatZonedMoment(focused.createdAt, tz)} · {focused.wordCount.toLocaleString()} words{focused.bytes != null && ` · ${formatBytes(Number(focused.bytes))}`}{focused.starred && " · ★ pinned across all scripts"}
                  {isFile && <> · <a href={storage.url(focused.ref)} target="_blank" rel="noreferrer" className="underline" data-open-original="">open the file</a></>}
                </span>
                <ProvenanceChip stamp={focused.writtenBy} what="report" timeZone={tz} />
              </div>
              {isFile && (focused.readState === "reading" || focused.readState === "unread") && (
                <p className="text-xs mb-3" data-research-reading="">Reading this file… it carries on in the background, and this page shows the text when it&apos;s done.</p>
              )}
              {(focused.readState === "reading" || focused.readState === "unread") && <AutoRefresh seconds={5} />}
              {focused.readNote && (
                <p className="text-xs mb-3" style={{ color: "var(--amber-on)" }} data-research-note="">{focused.readNote}</p>
              )}
              {editor && isFile && focused.readState !== "reading" && focused.readState !== "unread" && (
                <form action={rereadResearchAction} className="mb-3">
                  <input type="hidden" name="id" value={focused.id} />
                  <input type="hidden" name="channelId" value={id} />
                  <SubmitButton className="btn sm" pendingText="Starting…" data-read-again="">Read again</SubmitButton>
                </form>
              )}
              {editor && focused.kind === "ai_research" && (
                <form action={ideasFromReportAction} className="mb-3" data-make-ideas>
                  <input type="hidden" name="id" value={focused.id} />
                  <SubmitButton className="btn sm flex items-center gap-1.5" pendingText="Making ideas…"><Lightbulb className="w-3.5 h-3.5" /> Make ideas from this report</SubmitButton>
                </form>
              )}
              {/* A report is the model's markdown, rendered without raw HTML (E-IDE-15); other sources stay as extracted text. */}
              {focused.kind === "ai_research"
                ? <div data-report-rendered><MarkdownMessage content={focused.content ?? "(empty)"} /></div>
                : isFile && !text
                  ? <p className="text-sm text-[var(--mute)]">{focused.readState === "reading" || focused.readState === "unread" ? "No text yet." : "No text could be taken from this file."}</p>
                  : <pre className="text-sm whitespace-pre-wrap font-sans leading-[1.6]">{(text ?? "(empty)").slice(0, SHOWN_CHARS)}</pre>}
              {text && text.length > SHOWN_CHARS && focused.kind !== "ai_research" && (
                <p className="text-xs text-[var(--mute)] mt-2" data-research-shown="">Showing the first {SHOWN_CHARS.toLocaleString("en-US")} of {text.length.toLocaleString("en-US")} characters here. The assistant can read all of them.</p>
              )}
              {webSources.length > 0 && (
                <details className="mt-4 border-t border-[var(--line)] pt-3" data-web-sources>
                  <summary className="text-xs font-mono uppercase tracking-wider text-[var(--mute)] cursor-pointer">Web results it was given ({webSources.length})</summary>
                  <ol className="mt-2 mb-0 pl-5 text-xs flex flex-col gap-1">
                    {webSources.map((w, i) => (
                      <li key={i}><a href={w.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline break-all">{w.title || w.url}</a></li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          ) : (
            <div className="card text-center py-12 text-sm text-[var(--mute)]">Run a deep research to get started.</div>
          )}
        </main>
      </div>
    </div>
  );
}
