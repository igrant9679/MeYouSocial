import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { ensureMotifDirectives, parseMotifs } from "@/lib/motifs";
import { mergeBlogIdeasAction, updateBlogIdeaAction } from "@/app/actions/blog-ideas";

// One article idea's tags and its merge, off the board (IDE-20): every card
// carried this form and a list of every other open idea plus 60 site pages,
// so the board's HTML grew with the square of open ideas (957 KB on LSI).

type SP = { ok?: string; err?: string };

export default async function ArticleIdeaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const { ok, err } = await searchParams;
  const { workspace } = await requireRole("EDITOR");
  const idea = await db.blogIdea.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!idea) notFound();
  const live = idea.status !== "drafted" && idea.status !== "merged";

  const [pages, directives, others] = await Promise.all([
    db.sitePage.findMany({ where: { workspaceId: workspace.id }, select: { url: true, title: true }, orderBy: { title: "asc" }, take: 200 }),
    ensureMotifDirectives(workspace.id),
    db.blogIdea.findMany({
      where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] }, NOT: { id: idea.id } },
      orderBy: { title: "asc" },
      select: { id: true, title: true },
      take: 500,
    }),
  ]);
  const motifs = parseMotifs(idea.motifs);
  // A stored target page that isn't among the pages listed stays selectable.
  const pageOptions = idea.targetPage && !pages.some((p) => p.url === idea.targetPage)
    ? [{ url: idea.targetPage, title: idea.targetPage }, ...pages]
    : pages;

  return (
    <div className="max-w-2xl">
      <Link href="/ideas?format=article" className="text-xs font-mono text-[var(--mute)] hover:text-[var(--accent)] flex items-center gap-1 mb-3"><ArrowLeft className="w-3 h-3" /> Ideas board</Link>
      <h1 className="font-mono text-[22px] font-bold m-0 mb-1">{idea.title}</h1>
      <p className="text-xs text-[var(--mute)] mb-4">Article idea · {idea.status}</p>

      {(ok || err) && (
        <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={ok ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>{ok ?? err}</p>
      )}

      {!live ? (
        <div className="card text-sm">
          {idea.status === "merged"
            ? "This idea was merged into another one; its tags no longer change anything."
            : <>This idea has been drafted, so its tags are the article&apos;s now.{idea.postId && <> <Link href={`/blog/${idea.postId}`} className="underline">Open the draft</Link>.</>}</>}
        </div>
      ) : (
        <>
          <form action={updateBlogIdeaAction} className="card flex flex-col gap-2 mb-4">
            <h2 className="font-mono font-bold text-sm m-0">Tags</h2>
            <input type="hidden" name="id" value={idea.id} />
            <input type="hidden" name="back" value="edit" />
            <label className="text-[11px] text-[var(--mute)]">Title<input name="title" defaultValue={idea.title} className="w-full text-xs mt-0.5" /></label>
            <label className="text-[11px] text-[var(--mute)]">Angle<textarea name="angle" defaultValue={idea.angle ?? ""} rows={3} className="w-full text-xs mt-0.5" /></label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-[var(--mute)]">Keyword<input name="keyword" defaultValue={idea.keyword ?? ""} className="w-full text-xs mt-0.5" /></label>
              <label className="text-[11px] text-[var(--mute)]">Audience<input name="audience" defaultValue={idea.audience ?? ""} className="w-full text-xs mt-0.5" /></label>
              <label className="text-[11px] text-[var(--mute)]">Tier
                <select name="tier" defaultValue={idea.tier?.toString() ?? ""} className="w-full text-xs mt-0.5">
                  <option value="">no tier</option>
                  {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Tier {t}</option>)}
                </select>
              </label>
              <label className="text-[11px] text-[var(--mute)]">Seasonal hook<input name="seasonalHook" defaultValue={idea.seasonalHook ?? ""} className="w-full text-xs mt-0.5" /></label>
            </div>
            <label className="text-[11px] text-[var(--mute)]">Target page
              <select name="targetPage" defaultValue={idea.targetPage ?? ""} className="w-full text-xs mt-0.5">
                <option value="">no target page</option>
                {pageOptions.map((p) => <option key={p.url} value={p.url}>{p.title}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {directives.map((d) => (
                <label key={d.key} className="text-[10px]">
                  <span className="block text-[var(--mute)]">{d.label}</span>
                  <input name={`motif_${d.key}`} type="number" min={0} max={100} defaultValue={motifs.find((m) => m.key === d.key)?.weight ?? ""} className="w-full font-mono text-xs" />
                </label>
              ))}
            </div>
            <div><SubmitButton className="btn sm">Save tags</SubmitButton></div>
          </form>

          <form action={mergeBlogIdeasAction} className="card flex flex-col gap-2">
            <h2 className="font-mono font-bold text-sm m-0">Merge into another idea</h2>
            <p className="text-[11px] text-[var(--mute)] m-0">The other idea keeps its title and gains this one&apos;s angle and any tags it lacks; this one is marked merged.</p>
            <input type="hidden" name="sourceId" value={idea.id} />
            <input type="hidden" name="back" value="edit" />
            <select name="targetId" className="w-full text-xs" defaultValue="">
              <option value="">choose an idea</option>
              {others.map((o) => <option key={o.id} value={o.id}>{o.title.slice(0, 90)}</option>)}
            </select>
            <div><SubmitButton className="btn sm">Merge</SubmitButton></div>
          </form>
        </>
      )}
    </div>
  );
}
