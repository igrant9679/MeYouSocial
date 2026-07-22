import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { requireMembership, canEdit, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { SubmitButton } from "@/components/SubmitButton";
import {
  addCitationAction,
  advanceBlogStatusAction,
  deleteBlogPostAction,
  deleteCitationAction,
  generateBlogDraftAction,
  updateBlogPostAction,
  verifyCitationAction,
} from "@/app/actions/blog";
import { publishToWordPressAction } from "@/app/actions/blog-wp";

// Blog post editor (Spark port, slice 1): SEO metadata + HTML body + grounded
// AI draft + the review-state machine. Publishing is an ADMIN act (human gate).

const FLOW = ["drafting", "draft_review", "final_approval", "published"] as const;
const FLOW_LABELS: Record<(typeof FLOW)[number], string> = {
  drafting: "Drafting",
  draft_review: "Draft review",
  final_approval: "Final approval",
  published: "Published",
};

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace, membership } = await requireMembership();
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { citations: { orderBy: { createdAt: "asc" } } },
  });
  if (!post) notFound();
  const wpConn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });

  const editor = canEdit(membership.role);
  const admin = canAdmin(membership.role);
  const idx = FLOW.indexOf(post.status as (typeof FLOW)[number]);
  const nextIsPublish = FLOW[idx + 1] === "published";
  const unverified = post.citations.filter((c) => !c.verified).length;
  const checks = runBlogChecks(post, unverified);
  const gatesPass = requiredChecksPass(checks);

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> All posts
      </Link>

      {/* State rail */}
      <div className="card mb-4 flex flex-wrap items-center gap-2">
        {FLOW.map((s, i) => (
          <span
            key={s}
            className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full"
            style={
              i === idx
                ? { background: "var(--accent-soft)", color: "var(--accent-on)" }
                : { background: "var(--panel)", color: "var(--mute)" }
            }
          >
            {i + 1}. {FLOW_LABELS[s]}
          </span>
        ))}
        <span className="flex-1" />
        {editor && idx > 0 && post.status !== "published" && (
          <form action={advanceBlogStatusAction}>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="dir" value="back" />
            <button className="btn" title="Send back a stage"><ChevronLeft className="w-4 h-4" /> Back</button>
          </form>
        )}
        {editor && idx < FLOW.length - 1 && (!nextIsPublish || admin) && (
          <form action={advanceBlogStatusAction}>
            <input type="hidden" name="id" value={post.id} />
            <button className={nextIsPublish ? "btn primary" : "btn"} title={nextIsPublish ? "Publish (admin approval)" : "Advance a stage"}>
              {nextIsPublish ? "Approve & publish" : "Advance"} <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        )}
        {editor && nextIsPublish && !admin && (
          <span className="text-xs text-[var(--mute)]">Publishing needs an admin</span>
        )}
      </div>

      {/* WordPress publish (FR-11) — appears from final approval onward */}
      {(post.status === "final_approval" || post.status === "published") && (
        <div className="card mb-4 flex flex-wrap items-center gap-2 text-sm">
          <b>WordPress:</b>
          {post.publishedUrl ? (
            <a href={post.publishedUrl} target="_blank" rel="noreferrer" className="underline text-[var(--blue-on)] break-all">
              {post.publishedUrl}
            </a>
          ) : wpConn ? (
            <>
              <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={wpConn.status === "connected" ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--rose-soft)", color: "var(--rose-on)" }}>
                {wpConn.status}
              </span>
              <span className="flex-1" />
              {admin && (
                <>
                  <form action={publishToWordPressAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="dryRun" value="1" />
                    <SubmitButton className="btn" pendingText="Testing…">Dry run</SubmitButton>
                  </form>
                  <form action={publishToWordPressAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <SubmitButton className="btn primary" pendingText="Publishing…">Publish to WordPress</SubmitButton>
                  </form>
                </>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--mute)]">
              No site connected — <Link href="/blog/settings" className="underline">connect WordPress</Link> to publish directly.
            </span>
          )}
        </div>
      )}

      {/* Pre-publish checks (Spark gates — server-enforced on advance) */}
      <details className="card mb-4" open={!gatesPass}>
        <summary className="cursor-pointer select-none text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" style={{ color: gatesPass ? "var(--green-on)" : "var(--amber-on)" }} />
          Publish gates: {checks.filter((c) => c.required && c.pass).length}/{checks.filter((c) => c.required).length} required checks pass
          {!gatesPass && <span className="text-xs font-normal text-[var(--mute)]">— advancing to approval/publish is blocked</span>}
        </summary>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 text-xs">
              {c.pass ? (
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--green-on)" }} />
              ) : c.required ? (
                <X className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--rose-on)" }} />
              ) : (
                <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--amber-on)" }} />
              )}
              <span>
                {c.label}
                {c.detail ? <span className="text-[var(--mute)]"> · {c.detail}</span> : null}
                {!c.required && <span className="text-[var(--mute)]"> (advisory)</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* Citations (truthfulness dossier) */}
      <div className="card mb-4">
        <h2 className="text-sm font-semibold mb-2">
          Citations{" "}
          <span className="font-mono text-xs text-[var(--mute)]">
            {post.citations.length - unverified}/{post.citations.length} verified
          </span>
        </h2>
        {post.citations.length === 0 ? (
          <p className="text-xs text-[var(--mute)]">
            No claims to verify. AI drafts add a row here for every <span className="font-mono">[NEEDS SOURCE]</span> marker.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 mb-3">
            {post.citations.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs border-b border-[var(--line)] pb-2 last:border-0">
                <span
                  className="font-mono px-1.5 py-0.5 rounded-full shrink-0"
                  style={c.verified ? { background: "var(--green-soft)", color: "var(--green-on)" } : { background: "var(--amber-soft)", color: "var(--amber-on)" }}
                >
                  {c.verified ? "verified" : "unverified"}
                </span>
                <span className="flex-1 min-w-0">
                  {c.claim}
                  {c.sourceUrl && (
                    <>
                      {" "}
                      <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline text-[var(--blue-on)] break-all">
                        {c.sourceUrl}
                      </a>
                    </>
                  )}
                </span>
                {editor && !c.verified && (
                  <form action={verifyCitationAction} className="flex items-center gap-1 shrink-0">
                    <input type="hidden" name="id" value={c.id} />
                    <input name="sourceUrl" placeholder="source URL" defaultValue={c.sourceUrl ?? ""} className="w-40 text-xs" />
                    <button className="btn" title="Mark verified (needs a source URL)"><Check className="w-3.5 h-3.5" /></button>
                  </form>
                )}
                {editor && (
                  <form action={deleteCitationAction} className="shrink-0">
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn" title="Remove claim"><Trash2 className="w-3.5 h-3.5" /></button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editor && (
          <form action={addCitationAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="postId" value={post.id} />
            <input name="claim" required placeholder="Add a claim to verify…" className="flex-1 min-w-48 text-xs" />
            <input name="sourceUrl" placeholder="source URL (optional)" className="w-48 text-xs" />
            <button className="btn">Add</button>
          </form>
        )}
      </div>

      <form action={updateBlogPostAction} className="card flex flex-col gap-4">
        <input type="hidden" name="id" value={post.id} />
        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Title</span>
          <input name="title" defaultValue={post.title} required className="w-full font-semibold" disabled={!editor} />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Focus keyword</span>
            <input name="focusKeyword" defaultValue={post.focusKeyword ?? ""} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Audience</span>
            <input name="audience" defaultValue={post.audience ?? ""} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">URL slug</span>
            <input name="slug" defaultValue={post.slug ?? ""} placeholder="my-post-slug" className="w-full font-mono" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Word-count target</span>
            <input name="wordCountTarget" type="number" min={100} defaultValue={post.wordCountTarget ?? ""} placeholder="900" className="w-full font-mono" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Meta title <span className="font-mono">({(post.metaTitle ?? "").length}/60)</span></span>
            <input name="metaTitle" defaultValue={post.metaTitle ?? ""} maxLength={60} className="w-full" disabled={!editor} />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">Meta description <span className="font-mono">({(post.metaDescription ?? "").length}/155)</span></span>
            <input name="metaDescription" defaultValue={post.metaDescription ?? ""} maxLength={155} className="w-full" disabled={!editor} />
          </label>
        </div>

        <label className="text-sm">
          <span className="block text-xs text-[var(--mute)] mb-1">Body (HTML)</span>
          <textarea
            name="body"
            defaultValue={post.body ?? ""}
            rows={18}
            placeholder="Write here, or generate a grounded AI draft below."
            className="w-full font-mono text-xs leading-relaxed"
            disabled={!editor}
          />
        </label>

        {editor && (
          <div className="flex items-center gap-2">
            <SubmitButton className="btn primary">Save</SubmitButton>
          </div>
        )}
      </form>

      {editor && (
        <div className="flex items-center gap-2 mt-4">
          <form action={generateBlogDraftAction}>
            <input type="hidden" name="id" value={post.id} />
            <SubmitButton className="btn">
              <Sparkles className="w-4 h-4" /> {post.body ? "Regenerate draft" : "Generate draft"}
            </SubmitButton>
          </form>
          <span className="text-xs text-[var(--mute)]">
            Grounded in your channel voice + audience. Overwrites the body — save your edits first.
          </span>
          <span className="flex-1" />
          {admin && (
            <form action={deleteBlogPostAction}>
              <input type="hidden" name="id" value={post.id} />
              <button className="btn" title="Delete post"><Trash2 className="w-4 h-4" /> Delete</button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}
