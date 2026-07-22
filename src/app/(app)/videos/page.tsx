import Link from "next/link";
import { Clapperboard, Play, Trash2 } from "lucide-react";
import { requireMembership, canAdmin } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteRenderAction, processRenderNowAction } from "@/app/actions/videos";

// Phase 4 — short-form video renders. Queue → render → play. Mock provider by
// default; Veo activates via USE_MOCK_VIDEO=false + a Google key.

const STATUS_HUE: Record<string, string> = {
  queued: "amber",
  rendering: "blue",
  done: "green",
  failed: "rose",
};

export default async function VideosPage() {
  const { workspace, membership } = await requireMembership();
  const admin = canAdmin(membership.role);
  const renders = await db.videoRender.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const posts = new Map(
    (
      await db.blogPost.findMany({
        where: { id: { in: renders.map((r) => r.blogPostId).filter((x): x is string => !!x) } },
        select: { id: true, title: true },
      })
    ).map((p) => [p.id, p.title]),
  );

  return (
    <main className="p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Clapperboard className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Videos</h1>
          <p className="text-xs text-[var(--mute)]">
            Short-form renders packaged from your content. Provider: {env.USE_MOCK_VIDEO ? "mock (no cost)" : "Veo"} ·
            cap {env.VIDEO_DAILY_RENDER_CAP}/day · ≤{env.VIDEO_MAX_SECONDS}s per clip.
          </p>
        </div>
      </div>
      <p className="text-xs text-[var(--mute)] mb-5">
        Package a video from any published blog post (in the post editor), or let autopilot do it —
        set <b>Video packaging</b> / <b>Video rendering</b> modes under <Link href="/blog/automation" className="underline">Automation</Link>.
      </p>

      {renders.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-[var(--mute)]">
            No videos yet. Open a published blog post and hit “Create video package”.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {renders.map((r) => (
            <li key={r.id} className="card">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span
                  className="font-mono text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: `var(--${STATUS_HUE[r.status] ?? "cyan"}-soft)`, color: `var(--${STATUS_HUE[r.status] ?? "cyan"}-on)` }}
                >
                  {r.status}
                </span>
                <b className="text-sm flex-1 min-w-0 truncate">{r.title}</b>
                <span className="font-mono text-[10px] text-[var(--mute)]">
                  {r.provider} · {r.seconds}s · {r.aspect} · est ${r.costEstimate.toFixed(2)}
                </span>
                {admin && r.status === "queued" && (
                  <form action={processRenderNowAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn" pendingText="Rendering…"><Play className="w-3.5 h-3.5" /> Render now</SubmitButton>
                  </form>
                )}
                {admin && (
                  <form action={deleteRenderAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                  </form>
                )}
              </div>
              {r.blogPostId && posts.get(r.blogPostId) && (
                <p className="text-xs text-[var(--mute)] mb-1">
                  from <Link href={`/blog/${r.blogPostId}`} className="underline">{posts.get(r.blogPostId)}</Link>
                </p>
              )}
              <p className="text-xs text-[var(--slate)] mb-2">{r.prompt}</p>
              {r.status === "done" && r.outputUrl && (
                <video src={r.outputUrl} controls preload="metadata" className="rounded-lg max-h-72 border border-[var(--line)]" />
              )}
              {r.status === "done" && r.provider === "veo" && (
                <p className="text-[10px] text-[var(--mute)] mt-1">
                  Veo output links expire after ~2 days and need the Google key for retrieval — download promptly.
                </p>
              )}
              {r.status === "failed" && r.error && (
                <p className="text-xs" style={{ color: "var(--rose-on)" }}>{r.error}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
