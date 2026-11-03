import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { displayTimeZone } from "@/lib/display-zone";
import { diffBlocks, diffStats, textBlocks } from "@/lib/text-diff";
import { DiffRows } from "@/components/DiffView";
import { restoreScriptVersionAction } from "@/app/actions/canvas";
import { Banner } from "@/components/SocialPostCard";
import { SubmitButton } from "@/components/SubmitButton";

// Compare two versions of a script (E-VID-01): the body or the outline, any two
// kept snapshots or one against the current text, the words that changed marked
// — and Restore from here. Every overwrite (generation, Humanize, an agent run,
// a restore, a refused edit) keeps a snapshot first (VID-02), so nothing here is
// the only copy. Viewers read it; restoring is an editor's.

const CURRENT = "current";
const field = "border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs max-w-full";

/** The outline's markdown — the column holds `{ questions, markdown }` JSON; older snapshots hold bare markdown. */
function outlineText(raw: string | null): string | null {
  if (raw == null) return null;
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && "markdown" in j) return typeof j.markdown === "string" ? j.markdown : "";
  } catch {
    // bare markdown
  }
  return raw;
}

export default async function ScriptVersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; part?: string; ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const script = await db.script.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    select: { id: true, title: true, body: true, outline: true, updatedAt: true, versions: { orderBy: { createdAt: "desc" }, take: 60, select: { id: true, label: true, body: true, outline: true, wordCount: true, createdAt: true } } },
  });
  if (!script) notFound();
  const tz = await displayTimeZone(workspace.id);
  const part: "body" | "outline" = sp.part === "outline" ? "outline" : "body";
  const read = (v: { body: string | null; outline: string | null }) => (part === "body" ? v.body : outlineText(v.outline));
  // Only the snapshots that hold this part.
  const versions = script.versions.filter((v) => read(v) != null);
  const describe = (v: (typeof versions)[number]) => `${formatZonedMoment(v.createdAt, tz)} · ${v.label ?? "snapshot"}${part === "body" ? ` · ${v.wordCount} words` : ""}`;

  const pick = (key: string | undefined, fallback: string) => (key === CURRENT || versions.some((v) => v.id === key) ? key! : fallback);
  const aKey = pick(sp.a, versions[0]?.id ?? CURRENT);
  const bKey = pick(sp.b, CURRENT);
  const current = part === "body" ? script.body : outlineText(script.outline);
  const side = (key: string) => {
    if (key === CURRENT) return { title: "The current text", sub: `as of ${formatZonedMoment(script.updatedAt, tz)}`, text: current, version: null };
    const v = versions.find((x) => x.id === key)!;
    return { title: v.label ?? "snapshot", sub: formatZonedMoment(v.createdAt, tz), text: read(v), version: v };
  };
  const A = side(aKey), B = side(bKey);
  const rows = diffBlocks(textBlocks(A.text), textBlocks(B.text));
  const stats = diffStats(rows);
  const restorable = editor && A.version && (A.text ?? null) !== (current ?? null);
  const hrefFor = (p: "body" | "outline") => `/scripts/${script.id}/versions?part=${p}`;

  return (
    <main className="p-4 md:p-6 w-full">
      <Link href={`/scripts/${script.id}`} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> {script.title}
      </Link>
      <h1 className="font-mono font-bold text-2xl leading-tight mb-1 flex items-center gap-2"><History className="w-5 h-5" /> Compare script versions</h1>
      <p className="text-xs text-[var(--mute)] mb-3">Every generation, Humanize, agent run and restore keeps the text it replaced. Pick any two — or a version and the current text.</p>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}
      <div className="flex gap-2 mb-3 text-xs" data-version-part>
        {(["body", "outline"] as const).map((p) => (
          <Link key={p} href={hrefFor(p)} className="btn sm" style={p === part ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent-on)" } : undefined}>
            {p === "body" ? "Script" : "Outline"}
          </Link>
        ))}
      </div>

      {versions.length === 0 ? (
        <div className="card text-sm text-[var(--mute)]">No {part === "body" ? "script" : "outline"} versions kept yet — the first generation or overwrite makes one.</div>
      ) : (
        <>
          <form method="get" className="card mb-3 flex flex-wrap items-end gap-2 text-xs" data-version-pick>
            <input type="hidden" name="part" value={part} />
            <label className="min-w-0"><span className="block text-[10px] text-[var(--mute)] mb-1">From (older)</span>
              <select name="a" defaultValue={aKey} className={field} aria-label="Compare from">
                <option value={CURRENT}>The current text</option>
                {versions.map((v) => <option key={v.id} value={v.id}>{describe(v)}</option>)}
              </select></label>
            <label className="min-w-0"><span className="block text-[10px] text-[var(--mute)] mb-1">To (newer)</span>
              <select name="b" defaultValue={bKey} className={field} aria-label="Compare to">
                <option value={CURRENT}>The current text</option>
                {versions.map((v) => <option key={v.id} value={v.id}>{describe(v)}</option>)}
              </select></label>
            <button className="btn sm">Compare</button>
          </form>

          <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
            <span data-diff-stats>
              {stats.blocks === 0 ? "These two are the same." : (
                <><span style={{ color: "var(--green-on)" }}>+{stats.added} word{stats.added === 1 ? "" : "s"}</span> · <span style={{ color: "var(--rose-on)" }}>−{stats.removed} word{stats.removed === 1 ? "" : "s"}</span> · {stats.blocks} block{stats.blocks === 1 ? "" : "s"} changed</>
              )}
            </span>
            <span className="flex-1" />
            {restorable && A.version && (
              <form action={restoreScriptVersionAction} className="flex items-center gap-2 flex-wrap" data-restore>
                <input type="hidden" name="scriptId" value={script.id} />
                <input type="hidden" name="versionId" value={A.version.id} />
                <input type="hidden" name="back" value="versions" />
                <span className="text-[var(--mute)]">The current text is kept as a version first.</span>
                <SubmitButton className="btn sm" pendingText="Restoring…"><RotateCcw className="w-3 h-3" /> Restore “{A.title}”</SubmitButton>
              </form>
            )}
          </div>

          <div className="card p-0 overflow-hidden" data-diff>
            <div className="grid grid-cols-1 md:grid-cols-2 text-[11px] font-semibold border-b border-[var(--line)]">
              <div className="px-3 py-2 md:border-r border-[var(--line)]">From: {A.title} <span className="font-normal text-[var(--mute)]">· {A.sub}</span></div>
              <div className="px-3 py-2 hidden md:block">To: {B.title} <span className="font-normal text-[var(--mute)]">· {B.sub}</span></div>
            </div>
            <DiffRows rows={rows} />
          </div>
        </>
      )}
    </main>
  );
}
