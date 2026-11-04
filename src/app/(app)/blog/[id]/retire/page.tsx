import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Archive } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { articlesLinkingTo, redirectLines } from "@/lib/blog-retire";
import { draftOldPostAction, markRetiredAction, repointLinksAction } from "@/app/actions/blog-retire";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";

/**
 * Retire or merge a live article (E-IDE-04): choose where its address should
 * point — another live article (a merge) or any address — and get the
 * checklist that leaves no dead ends: the 301 to add, the workspace's own
 * links to repoint, the old post on WordPress, and the record here.
 */
export default async function RetireArticlePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ to?: string }> }) {
  const { id } = await params;
  const { to: rawTo } = await searchParams;
  const { workspace, membership } = await requireMembership();
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true, publishedUrl: true, wpPostId: true, retiredAt: true, redirectTo: true } });
  if (!post) notFound();
  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const tz = await getPostingTimeZone(workspace.id);
  const others = await db.blogPost.findMany({
    where: { workspaceId: workspace.id, status: "published", publishedUrl: { not: null }, retiredAt: null, id: { not: post.id } },
    select: { id: true, title: true, publishedUrl: true },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });
  const to = (rawTo ?? post.redirectTo ?? "").trim();
  let target: string | null = null;
  try {
    if (to && /^https?:$/.test(new URL(to).protocol)) target = to;
  } catch {
    target = null;
  }
  const merging = target ? others.find((o) => o.publishedUrl === target) ?? null : null;
  const linking = post.publishedUrl ? await articlesLinkingTo(workspace.id, post.publishedUrl, post.id) : [];
  const lines = post.publishedUrl && target ? redirectLines(post.publishedUrl, target) : null;

  return (
    <main className="w-full max-w-3xl">
      <Link href={`/blog/${post.id}?tab=distribute`} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> {post.title}
      </Link>
      <h1 className="font-mono font-bold text-2xl leading-tight mb-1 flex items-center gap-2"><Archive className="w-6 h-6" /> Retire or merge</h1>
      <p className="text-xs text-[var(--mute)] mb-4">
        When an article is folded into another or taken down, its address shouldn&apos;t become a dead end: readers and search engines
        get sent on, and your own articles stop linking to it.
      </p>

      {!post.publishedUrl ? (
        <div className="card text-sm" data-retire-error="">This article has no live address, so there&apos;s nothing to redirect.</div>
      ) : (
        <>
          {post.retiredAt && (
            <div className="card mb-4 text-xs" data-retired="" style={{ borderColor: "var(--amber)" }}>
              Retired {formatZonedMoment(post.retiredAt, tz)} — <span className="break-all">{post.publishedUrl}</span> points at{" "}
              <a href={post.redirectTo ?? "#"} className="underline break-all">{post.redirectTo}</a>.
            </div>
          )}
          <form method="get" className="card mb-4 flex flex-col gap-2 text-xs" data-retire-target="">
            <span className="font-semibold">Where should <span className="break-all">{post.publishedUrl}</span> point?</span>
            <label className="flex flex-col gap-0.5">
              <span className="text-[var(--mute)]">Merge into one of your live articles</span>
              <select name="to" defaultValue={merging?.publishedUrl ?? ""}>
                <option value="">—</option>
                {others.map((o) => <option key={o.id} value={o.publishedUrl!}>{o.title}</option>)}
              </select>
            </label>
            <div><SubmitButton className="btn sm">Show the checklist</SubmitButton></div>
          </form>
          <form method="get" className="card mb-4 flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-0.5 flex-1 min-w-60">
              <span className="text-[var(--mute)]">…or retire it to any address (your home page, a category, a newer page elsewhere)</span>
              <input name="to" type="url" defaultValue={merging ? "" : target ?? ""} placeholder="https://…" />
            </label>
            <SubmitButton className="btn sm">Show the checklist</SubmitButton>
          </form>

          {target && lines && (
            <ol className="flex flex-col gap-3 m-0 p-0 list-none" data-retire-checklist={merging ? "merge" : "retire"}>
              <li className="card text-xs" data-step="redirect">
                <b>1. Add a permanent (301) redirect</b> from the old address to{" "}
                {merging ? <>“{merging.title}”</> : <span className="break-all">{target}</span>}. It lives on your host or in a WordPress redirect plugin — paste one of these:
                <div className="flex flex-col gap-1 mt-2">
                  <label className="flex flex-col gap-0.5"><span className="text-[var(--mute)]">Apache (.htaccess)</span><input readOnly value={lines.htaccess} className="font-code text-[11px]" data-line="htaccess" /></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[var(--mute)]">Nginx</span><input readOnly value={lines.nginx} className="font-code text-[11px]" data-line="nginx" /></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[var(--mute)]">Redirection plugin (CSV import)</span><input readOnly value={lines.csv} className="font-code text-[11px]" data-line="csv" /></label>
                </div>
              </li>
              <li className="card text-xs" data-step="links">
                <b>2. Repoint your own links.</b>{" "}
                {linking.length === 0 ? (
                  <span className="text-[var(--mute)]" data-links-none="">None of your articles links to it.</span>
                ) : (
                  <>
                    {linking.reduce((a, l) => a + l.links, 0)} link{linking.reduce((a, l) => a + l.links, 0) === 1 ? "" : "s"} in {linking.length} article{linking.length === 1 ? "" : "s"}:
                    <ul className="mt-1.5 mb-2 pl-4" data-linking="">
                      {linking.map((l) => (
                        <li key={l.id}>
                          <Link href={`/blog/${l.id}`} className="underline">{l.title}</Link> — {l.links}
                          {l.live && <> · <Link href={`/blog/${l.id}/update`} className="underline">Update on WordPress…</Link></>}
                        </li>
                      ))}
                    </ul>
                    {editor && (
                      <form action={repointLinksAction}>
                        <input type="hidden" name="postId" value={post.id} />
                        <input type="hidden" name="to" value={target} />
                        <SubmitButton className="btn sm primary" pendingText="Repointing…">Point them at the new address</SubmitButton>
                        <span className="text-[11px] text-[var(--mute)] ml-2">Each article is saved as a version first. Live ones then need Update on WordPress.</span>
                      </form>
                    )}
                  </>
                )}
              </li>
              {post.wpPostId != null && (
                <li className="card text-xs" data-step="wordpress">
                  <b>3. Take the old post down on WordPress</b> — once the redirect is in place, so nobody lands on a gap.
                  {admin ? (
                    <form action={draftOldPostAction} className="mt-2">
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="to" value={target} />
                      <SubmitButton className="btn sm" pendingText="Moving…">Move it to draft on WordPress</SubmitButton>
                    </form>
                  ) : (
                    <span className="text-[var(--mute)]"> An admin can move it to draft from here.</span>
                  )}
                </li>
              )}
              <li className="card text-xs" data-step="record">
                <b>{post.wpPostId != null ? "4" : "3"}. Record it here</b> — the article is marked retired and stops producing refresh ideas.
                {editor && (
                  <form action={markRetiredAction} className="mt-2">
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="to" value={target} />
                    <SubmitButton className="btn sm" pendingText="Recording…">{post.retiredAt ? "Update where it points" : "Mark it retired"}</SubmitButton>
                  </form>
                )}
              </li>
            </ol>
          )}
        </>
      )}
    </main>
  );
}
