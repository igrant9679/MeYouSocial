import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UploadCloud } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { DiffRows } from "@/components/DiffView";
import { SubmitButton } from "@/components/SubmitButton";
import { blockingChecks } from "@/lib/blog-gates";
import { compareWithLive } from "@/lib/wp-update";
import { updateOnWordPressAction } from "@/app/actions/blog-wp";
import { getPostingTimeZone } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";

/**
 * E-ART-02: what "Update on WordPress" would change on a live article — the
 * site's current post read back and compared with what publishing sends now —
 * and the button that pushes it. Anyone can look; only an admin can push.
 */
export default async function UpdateOnWordPressPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true, wpPostId: true, publishedAt: true } });
  if (!post) notFound();
  const admin = canAdmin(membership.role);
  const [cmp, blocking, tz] = await Promise.all([compareWithLive(workspace.id, post.id), blockingChecks(workspace.id, post.id), getPostingTimeZone(workspace.id)]);

  return (
    <main className="w-full max-w-4xl">
      <Link href={`/blog/${post.id}`} className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> {post.title}
      </Link>
      <h1 className="font-mono font-bold text-2xl leading-tight mb-1 flex items-center gap-2"><UploadCloud className="w-6 h-6" /> Update on WordPress</h1>
      <p className="text-xs text-[var(--mute)] mb-4">
        What the live post says now, against what publishing would send — the same render, compared block by block and word by word.
        Images compare by their alt text, so an address the site rewrote isn&apos;t a change.
      </p>

      {!cmp.ok ? (
        <div className="card text-sm" data-update-error="">{cmp.error}</div>
      ) : (
        <>
          <div className="card mb-4 text-xs flex flex-col gap-1.5" data-update-summary="">
            <div>
              Live at <a href={cmp.link} target="_blank" rel="noreferrer" className="underline break-all">{cmp.link}</a>
              {cmp.liveModified && <span className="text-[var(--mute)]"> · last changed there {formatZonedMoment(new Date(cmp.liveModified), tz)}</span>}
            </div>
            {cmp.unchanged ? (
              <div className="font-semibold" data-update-unchanged="">Nothing to update — the site already says exactly this.</div>
            ) : (
              <div data-update-stats={`${cmp.stats.added}/${cmp.stats.removed}`}>
                <b>{cmp.stats.added}</b> word{cmp.stats.added === 1 ? "" : "s"} added, <b>{cmp.stats.removed}</b> removed
                {cmp.title.changed && <> · the <b>title</b> changes</>}
                {cmp.excerpt.changed && <> · the <b>description</b> changes</>}
                {cmp.imagesChanged.length > 0 && <> · new <b>{cmp.imagesChanged.join(" and ")}</b></>}
              </div>
            )}
            {cmp.title.changed && (
              <div data-update-title="">
                <span className="text-[var(--mute)]">Title:</span> <del className="text-[var(--rose-on)]">{cmp.title.live}</del> → <ins className="text-[var(--green-on)] no-underline">{cmp.title.now}</ins>
              </div>
            )}
            {cmp.excerpt.changed && (
              <div data-update-excerpt="">
                <span className="text-[var(--mute)]">Description:</span> <del className="text-[var(--rose-on)]">{cmp.excerpt.live || "(none)"}</del> → <ins className="text-[var(--green-on)] no-underline">{cmp.excerpt.now || "(none)"}</ins>
              </div>
            )}
          </div>

          {!cmp.unchanged && (cmp.stats.added > 0 || cmp.stats.removed > 0) && (
            <div className="card mb-4" data-update-diff="">
              <DiffRows rows={cmp.rows} />
            </div>
          )}

          {admin && !cmp.unchanged && (
            <div className="card flex flex-wrap items-center gap-2">
              {blocking?.length ? (
                <p className="text-xs m-0" style={{ color: "var(--rose-on)" }} data-update-held="">
                  Held by the publish checks: {blocking.join("; ")}. Fix them on the article first.
                </p>
              ) : (
                <form action={updateOnWordPressAction} className="flex items-center gap-2" data-update-form="">
                  <input type="hidden" name="postId" value={post.id} />
                  <SubmitButton className="btn primary" pendingText="Updating…">Update on WordPress</SubmitButton>
                  <span className="text-[11px] text-[var(--mute)]">Replaces the live post in place, at the same address. It&apos;s recorded with what changed.</span>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
