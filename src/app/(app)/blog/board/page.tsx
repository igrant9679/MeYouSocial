import Link from "next/link";
import { ArrowLeft, KanbanSquare } from "lucide-react";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// Workflow board (Spark M5 port): every post by lifecycle column. Transitions
// happen inside the post editor — this is the overview.

const COLUMNS = [
  { status: "drafting", title: "Drafting", hue: "amber" },
  { status: "draft_review", title: "Draft review", hue: "blue" },
  { status: "final_approval", title: "Final approval", hue: "violet" },
  { status: "published", title: "Published", hue: "green" },
] as const;

export default async function BlogBoardPage() {
  const { workspace } = await requireMembership();
  const posts = await db.blogPost.findMany({
    where: { workspaceId: workspace.id },
    include: { citations: { where: { verified: false }, select: { id: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <main className="p-6 w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--pink-soft)", color: "var(--pink-on)" }}>
          <KanbanSquare className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Workflow board</h1>
          <p className="text-xs text-[var(--mute)]">Every post and its stage; unverified-citation counts surface here.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {COLUMNS.map((col) => {
          const items = posts.filter((p) => p.status === col.status);
          return (
            <section key={col.status} className="card">
              <h2 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: `var(--${col.hue}-on)` }}>
                {col.title} <span className="font-mono">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-xs text-[var(--mute)] py-2 text-center">Empty</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {items.map((p) => (
                    <li key={p.id} className="rounded-lg border border-[var(--line)] p-2" style={{ background: "var(--zebra)" }}>
                      <Link href={`/blog/${p.id}`} className="text-xs font-semibold underline leading-snug block">
                        {p.title}
                      </Link>
                      <div className="text-[10px] text-[var(--mute)] mt-0.5 font-mono">
                        {p.updatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        {p.citations.length > 0 && (
                          <span className="ml-1 px-1 rounded-full" style={{ background: "var(--amber-soft)", color: "var(--amber-on)" }}>
                            {p.citations.length} unverified
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
