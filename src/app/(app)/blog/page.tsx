import Link from "next/link";
import { FileText, Lightbulb, Plus, Sparkles, Zap } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { SubmitButton } from "@/components/SubmitButton";
import { createBlogPostAction } from "@/app/actions/blog";
import {
  addBlogIdeaAction,
  autoDraftApprovedAction,
  discoverBlogIdeasAction,
  draftFromIdeaAction,
  setBlogIdeaStatusAction,
} from "@/app/actions/blog-ideas";

// Blog list (ported from Spark's article pipeline — slice 1). Workspace-scoped
// posts grouped by review state; the chip colors use the hue tokens so they
// adapt to dark mode.

const STATUS_META: Record<string, { label: string; hue: string }> = {
  drafting: { label: "Drafting", hue: "amber" },
  draft_review: { label: "Draft review", hue: "blue" },
  final_approval: { label: "Final approval", hue: "violet" },
  published: { label: "Published", hue: "green" },
};

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, hue: "cyan" };
  return (
    <span
      className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `var(--${meta.hue}-soft)`, color: `var(--${meta.hue}-on)` }}
    >
      {meta.label}
    </span>
  );
}

export default async function BlogPage() {
  const { workspace, membership } = await requireMembership();
  const [posts, ideas] = await Promise.all([
    db.blogPost.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { updatedAt: "desc" },
    }),
    db.blogIdea.findMany({
      where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] } },
      orderBy: { createdAt: "desc" },
      take: 24,
    }),
  ]);
  const editor = canEdit(membership.role);
  const discovered = ideas.filter((i) => i.status === "discovered");
  const approved = ideas.filter((i) => i.status === "approved");

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          <FileText className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="min-w-40">
          <h1 className="font-mono font-bold text-2xl leading-tight">Blog</h1>
          <p className="text-xs text-[var(--mute)]">
            Idea → grounded draft → gates → publish. Drafts are grounded in your organization profile.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-5">
        <Link href="/blog/ideas" className="btn">Idea board</Link>
        <Link href="/blog/keywords" className="btn">Keywords</Link>
        <Link href="/blog/board" className="btn">Board</Link>
        <Link href="/blog/calendar" className="btn">Calendar</Link>
        <Link href="/blog/analytics" className="btn">Analytics</Link>
        <Link href="/blog/audit" className="btn">Content audit</Link>
        <Link href="/blog/report" className="btn">Report</Link>
        <Link href="/blog/automation" className="btn">Automation</Link>
        <Link href="/blog/organization" className="btn">Organization</Link>
        <Link href="/blog/brand" className="btn">Brand &amp; motifs</Link>
        <Link href="/blog/experts" className="btn">Experts</Link>
        <Link href="/blog/settings" className="btn">Settings</Link>
      </div>

      {editor && (
        <form action={createBlogPostAction} className="card mb-5 flex flex-wrap items-end gap-3">
          <label className="flex-1 min-w-48 text-sm">
            <span className="block text-xs text-[var(--mute)] mb-1">New post title</span>
            <input name="title" required placeholder="e.g. Five signs your nonprofit needs a grant-management overhaul" className="w-full" />
          </label>
          <label className="text-sm w-40">
            <span className="block text-xs text-[var(--mute)] mb-1">Focus keyword</span>
            <input name="focusKeyword" placeholder="optional" className="w-full" />
          </label>
          <button className="btn primary" type="submit">
            <Plus className="w-4 h-4" /> Create
          </button>
        </form>
      )}

      {/* Idea engine (Spark FR-5) */}
      {editor && (
        <div className="card mb-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="w-8 h-8 rounded-xl grid place-items-center" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
              <Lightbulb className="w-4 h-4" />
            </span>
            <h2 className="text-sm font-semibold flex-1">
              Idea engine{" "}
              <span className="font-mono text-xs text-[var(--mute)]">{discovered.length} discovered · {approved.length} approved</span>
            </h2>
            <form action={discoverBlogIdeasAction}>
              <SubmitButton className="btn" pendingText="Discovering…">
                <Sparkles className="w-4 h-4" /> Discover ideas (AI)
              </SubmitButton>
            </form>
            {approved.length > 0 && (
              <form action={autoDraftApprovedAction}>
                <SubmitButton className="btn primary" pendingText="Drafting…">
                  <Zap className="w-4 h-4" /> Auto-draft approved (max 2)
                </SubmitButton>
              </form>
            )}
          </div>

          <form action={addBlogIdeaAction} className="flex flex-wrap items-center gap-2 mb-3">
            <input name="title" required placeholder="Add an idea manually…" className="flex-1 min-w-48 text-xs" />
            <input name="keyword" placeholder="keyword (optional)" className="w-40 text-xs" />
            <button className="btn"><Plus className="w-3.5 h-3.5" /> Add</button>
          </form>

          {ideas.length === 0 ? (
            <p className="text-xs text-[var(--mute)]">
              No open ideas. Discover some with AI — grounded in your organization profile.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {ideas.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-xs border-b border-[var(--line)] pb-1.5 last:border-0">
                  <span
                    className="font-mono px-1.5 py-0.5 rounded-full shrink-0"
                    style={
                      i.status === "approved"
                        ? { background: "var(--green-soft)", color: "var(--green-on)" }
                        : { background: "var(--blue-soft)", color: "var(--blue-on)" }
                    }
                  >
                    {i.status}
                  </span>
                  <span className="flex-1 min-w-0">
                    <b>{i.title}</b>
                    {i.keyword ? <span className="text-[var(--mute)]"> · kw: {i.keyword}</span> : null}
                    {i.angle ? <span className="block text-[var(--mute)] mt-0.5">{i.angle}</span> : null}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {i.status === "discovered" && (
                      <form action={setBlogIdeaStatusAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button className="btn" title="Approve for the auto-draft queue">Approve</button>
                      </form>
                    )}
                    <form action={draftFromIdeaAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <SubmitButton className="btn" pendingText="Drafting…">Draft now</SubmitButton>
                    </form>
                    <form action={setBlogIdeaStatusAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="status" value="rejected" />
                      <button className="btn" title="Reject">✕</button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)]">
            No posts yet. {editor ? "Create the first one above — then generate a grounded AI draft inside it." : "Posts will appear here once an editor creates them."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {posts.map((p) => (
            <li key={p.id}>
              <Link href={`/blog/${p.id}`} className="card flex items-center gap-3 hover:border-[var(--line-2)] transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{p.title}</div>
                  <div className="text-xs text-[var(--mute)] mt-0.5">
                    {p.focusKeyword ? <>kw: <b>{p.focusKeyword}</b> · </> : null}
                    updated {p.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    {p.body ? ` · ~${p.body.split(/\s+/).length} words` : " · no draft yet"}
                  </div>
                </div>
                <StatusChip status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
