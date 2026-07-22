import Link from "next/link";
import { ArrowLeft, ChartLine, Lock, LockOpen } from "lucide-react";
import { requireMembership, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { toggleProtectAction, recordSnapshotAction } from "@/app/actions/blog-analytics";

// Blog analytics (Spark FR-14 port): manual snapshots per published post,
// aggregate tiles, refresh candidates (position > 10), top performers, and the
// protect-from-rewrite toggle. Numbers are operator-entered — never invented.

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-GB");
}

export default async function BlogAnalyticsPage() {
  const { workspace, membership } = await requireMembership();
  const editor = canEdit(membership.role);
  const posts = await db.blogPost.findMany({
    where: { workspaceId: workspace.id, status: "published" },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 2 } },
    orderBy: { publishedAt: "desc" },
  });

  const withLatest = posts.map((p) => ({ post: p, latest: p.snapshots[0] ?? null }));
  const tracked = withLatest.filter((x) => x.latest);
  const sum = (f: (s: NonNullable<(typeof tracked)[number]["latest"]>) => number | null) =>
    tracked.reduce((a, x) => a + (f(x.latest!) ?? 0), 0);
  const impressions = sum((s) => s.impressions);
  const clicks = sum((s) => s.clicks);
  const positions = tracked.map((x) => x.latest!.position).filter((p): p is number => p != null);
  const avgPos = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : null;

  const refreshCandidates = tracked
    .filter((x) => (x.latest!.position ?? 0) > 10)
    .sort((a, b) => (b.latest!.position ?? 0) - (a.latest!.position ?? 0))
    .slice(0, 5);
  const topPerformers = [...tracked]
    .sort((a, b) => (b.latest!.clicks ?? 0) - (a.latest!.clicks ?? 0))
    .slice(0, 5);

  return (
    <main className="p-6 max-w-5xl mx-auto w-full">
      <Link href="/blog" className="inline-flex items-center gap-1 text-xs text-[var(--mute)] hover:text-[var(--ink)] mb-3">
        <ArrowLeft className="w-3.5 h-3.5" /> Blog
      </Link>
      <div className="flex items-center gap-3 mb-5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--blue-soft)", color: "var(--blue-on)" }}>
          <ChartLine className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="font-mono font-bold text-2xl leading-tight">Blog analytics</h1>
          <p className="text-xs text-[var(--mute)]">
            Operator-entered snapshots per published post — never invented. GSC/GA4 connectors replace manual entry later.
          </p>
        </div>
      </div>

      {/* Aggregate tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Published posts", value: fmt(posts.length) },
          { label: "Impressions (latest)", value: fmt(impressions) },
          { label: "Clicks (latest)", value: fmt(clicks) },
          { label: "Avg position", value: avgPos == null ? "—" : avgPos.toFixed(1) },
        ].map((t) => (
          <div key={t.label} className="card">
            <div className="font-mono font-bold text-xl">{t.value}</div>
            <div className="text-xs text-[var(--mute)] mt-0.5">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Feedback loops */}
      {(refreshCandidates.length > 0 || topPerformers.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Refresh candidates <span className="text-xs font-normal text-[var(--mute)]">(position &gt; 10)</span></h2>
            {refreshCandidates.length === 0 ? (
              <p className="text-xs text-[var(--mute)]">None — nothing ranks worse than position 10.</p>
            ) : (
              <ul className="text-xs flex flex-col gap-1">
                {refreshCandidates.map((x) => (
                  <li key={x.post.id} className="flex justify-between gap-2">
                    <Link href={`/blog/${x.post.id}`} className="underline truncate">{x.post.title}</Link>
                    <span className="font-mono shrink-0">pos {x.latest!.position?.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card">
            <h2 className="text-sm font-semibold mb-2">Top performers <span className="text-xs font-normal text-[var(--mute)]">(by clicks — consider protecting)</span></h2>
            {topPerformers.length === 0 ? (
              <p className="text-xs text-[var(--mute)]">Record snapshots to populate.</p>
            ) : (
              <ul className="text-xs flex flex-col gap-1">
                {topPerformers.map((x) => (
                  <li key={x.post.id} className="flex justify-between gap-2">
                    <Link href={`/blog/${x.post.id}`} className="underline truncate">{x.post.title}</Link>
                    <span className="font-mono shrink-0">{fmt(x.latest!.clicks)} clicks</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Per-post table + inline snapshot entry */}
      {posts.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)]">No published posts yet — analytics start once something ships.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--mute)] border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-semibold">Post</th>
                <th className="py-2 pr-3 font-semibold">Impr.</th>
                <th className="py-2 pr-3 font-semibold">Clicks</th>
                <th className="py-2 pr-3 font-semibold">Pos.</th>
                <th className="py-2 pr-3 font-semibold">As of</th>
                {editor && <th className="py-2 pr-3 font-semibold">Record snapshot</th>}
                {editor && <th className="py-2 font-semibold">Protect</th>}
              </tr>
            </thead>
            <tbody>
              {withLatest.map(({ post, latest }) => (
                <tr key={post.id} className="border-b border-[var(--line)] last:border-0 align-top">
                  <td className="py-2 pr-3 max-w-56">
                    <Link href={`/blog/${post.id}`} className="underline">{post.title}</Link>
                    {post.protectedFromRewrite && (
                      <span className="ml-1 font-mono text-[10px] px-1.5 rounded-full" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
                        protected
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 font-mono">{fmt(latest?.impressions)}</td>
                  <td className="py-2 pr-3 font-mono">{fmt(latest?.clicks)}</td>
                  <td className="py-2 pr-3 font-mono">{latest?.position?.toFixed(1) ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono">
                    {latest ? latest.capturedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                  {editor && (
                    <td className="py-2 pr-3">
                      <form action={recordSnapshotAction} className="flex items-center gap-1">
                        <input type="hidden" name="postId" value={post.id} />
                        <input name="impressions" placeholder="impr" className="w-14 font-mono" />
                        <input name="clicks" placeholder="clk" className="w-12 font-mono" />
                        <input name="position" placeholder="pos" className="w-12 font-mono" />
                        <button className="btn">Save</button>
                      </form>
                    </td>
                  )}
                  {editor && (
                    <td className="py-2">
                      <form action={toggleProtectAction}>
                        <input type="hidden" name="postId" value={post.id} />
                        <button className="btn" title={post.protectedFromRewrite ? "Unprotect (allow regeneration)" : "Protect from rewrite"}>
                          {post.protectedFromRewrite ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
