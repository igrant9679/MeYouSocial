import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, History, RotateCcw } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";
import { diffBlocks, diffStats, htmlBlocks } from "@/lib/text-diff";
import { DiffRows } from "@/components/DiffView";
import { actorRecordedFrom, versionActor } from "@/lib/version-actor";
import { restoreBlogVersionAction } from "@/app/actions/blog";
import { Banner } from "@/components/SocialPostCard";
import { SubmitButton } from "@/components/SubmitButton";

// Compare two versions of an article (E-ART-03): any two kept versions, or a
// version against the current text, side by side with the words that changed
// marked — and Restore from here, so a restore is never blind.

const CURRENT = "current";
const field = "border border-[var(--line-2)] rounded-lg px-2 py-1 text-xs max-w-full";

export default async function ArticleVersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, title: true, body: true, updatedAt: true, versions: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, label: true, body: true, actorId: true, createdAt: true } } },
  });
  if (!post) notFound();
  const [tz, since, members] = await Promise.all([
    getPostingTimeZone(workspace.id),
    actorRecordedFrom(),
    db.membership.findMany({ where: { workspaceId: workspace.id }, select: { userId: true, user: { select: { name: true, email: true } } } }),
  ]);
  const names = new Map(members.map((m) => [m.userId, m.user.name ?? m.user.email ?? "a member"]));
  const versions = post.versions;
  const describe = (v: (typeof versions)[number]) => `${formatZonedMoment(v.createdAt, tz)} · ${v.label} · ${versionActor(v, names, since)}`;

  // Default: the newest kept version against the text as it is now.
  const pick = (key: string | undefined, fallback: string) => (key === CURRENT || versions.some((v) => v.id === key) ? key! : fallback);
  const aKey = pick(sp.a, versions[0]?.id ?? CURRENT);
  const bKey = pick(sp.b, CURRENT);
  const side = (key: string) => {
    if (key === CURRENT) return { title: "The current text", sub: `as of ${formatZonedMoment(post.updatedAt, tz)}`, body: post.body, version: null };
    const v = versions.find((x) => x.id === key)!;
    return { title: v.label, sub: `${formatZonedMoment(v.createdAt, tz)} · ${versionActor(v, names, since)}`, body: v.body, version: v };
  };
  const A = side(aKey), B = side(bKey);
  const rows = diffBlocks(htmlBlocks(A.body), htmlBlocks(B.body));
  const stats = diffStats(rows);
  const restorable = editor && A.version && (A.version.body ?? null) !== (post.body ?? null);

  return (
    <main className="p-4 md:p-6 w-full">
      <Link href={`/blog/${post.id}?tab=write`} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> {post.title}
      </Link>
      <h1 className="font-mono font-bold text-2xl leading-tight mb-1 flex items-center gap-2"><History className="w-5 h-5" /> Compare versions</h1>
      <p className="text-xs text-[var(--mute)] mb-3">Every generation, save, restore and applied finding keeps a version. Pick any two — or a version and the current text.</p>
      {sp.ok && <Banner kind="ok" text={sp.ok} />}
      {sp.err && <Banner kind="err" text={sp.err} />}

      {versions.length === 0 ? (
        <div className="card text-sm text-[var(--mute)]">No versions kept yet — the first generation or save makes one.</div>
      ) : (
        <>
          <form method="get" className="card mb-3 flex flex-wrap items-end gap-2 text-xs" data-version-pick>
            <label className="min-w-0"><span className="block text-[10px] text-[var(--mute)] mb-1">From (older)</span>
              <select key={`a:${aKey}`} name="a" defaultValue={aKey} className={field} aria-label="Compare from">
                <option value={CURRENT}>The current text</option>
                {versions.map((v) => <option key={v.id} value={v.id}>{describe(v)}</option>)}
              </select></label>
            <label className="min-w-0"><span className="block text-[10px] text-[var(--mute)] mb-1">To (newer)</span>
              <select key={`b:${bKey}`} name="b" defaultValue={bKey} className={field} aria-label="Compare to">
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
              <form action={restoreBlogVersionAction} className="flex items-center gap-2" data-restore>
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
