import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { createBlogPostAction } from "@/app/actions/blog";

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
  const posts = await db.blogPost.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { updatedAt: "desc" },
  });
  const editor = canEdit(membership.role);

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--rose-soft)", color: "var(--rose-on)" }}>
          <FileText className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Blog</h1>
          <p className="text-xs text-[var(--mute)]">
            Idea → grounded draft → review → publish. Ported from Spark; SEO gates and WordPress publish land next.
          </p>
        </div>
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
