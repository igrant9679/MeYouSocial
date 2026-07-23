import Link from "next/link";
import { Clapperboard, Play, Trash2 } from "lucide-react";
import { requireMembership, canAdmin, canEdit } from "@/lib/acl";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteRenderAction, processRenderNowAction, retryRenderAction } from "@/app/actions/videos";
import { getVideoProviderSetting } from "@/lib/video";

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
  const editor = canEdit(membership.role);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [renders, todayCount, providerSetting] = await Promise.all([
    db.videoRender.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.videoRender.count({
      where: { workspaceId: workspace.id, status: { in: ["rendering", "done"] }, updatedAt: { gte: dayStart } },
    }),
    getVideoProviderSetting(),
  ]);
  const todaySpend = renders
    .filter((r) => (r.status === "done" || r.status === "rendering") && r.updatedAt >= dayStart)
    .reduce((a, r) => a + r.costEstimate, 0);
  const posts = new Map(
    (
      await db.blogPost.findMany({
        where: { id: { in: renders.map((r) => r.blogPostId).filter((x): x is string => !!x) } },
        select: { id: true, title: true },
      })
    ).map((p) => [p.id, p.title]),
  );

  return (
    // Full width like the rest of the app (the shell main already pads 24px —
    // the old p-6 here double-padded on top of it).
    <main className="w-full">
      <div className="flex items-center gap-3 mb-1.5">
        <span className="w-12 h-12 rounded-2xl grid place-items-center" style={{ background: "var(--violet-soft)", color: "var(--violet-on)" }}>
          <Clapperboard className="w-6 h-6" strokeWidth={2.25} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="font-mono font-bold text-2xl leading-tight">Videos</h1>
          <p className="text-xs text-[var(--mute)]">
            Storyboards → scene renders → captions → voiceover. Provider:{" "}
            <b>{providerSetting === "mock" ? "mock (no cost)" : providerSetting === "veo" ? "Veo" : "auto"}</b>
            {" "}(<Link href="/admin/api-keys" className="underline">change in Admin → API keys</Link>) ·
            ≤{env.VIDEO_MAX_SECONDS}s per scene.
          </p>
        </div>
      </div>

      {/* Budget bar — renders + estimated spend against today's cap */}
      <div className="card mb-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--mute)] shrink-0">Today</span>
          <div className="flex-1 h-2.5 rounded-full bg-[var(--panel)] overflow-hidden">
            <div
              className="h-full rounded-full anim-grow"
              style={{
                width: `${Math.min(100, (todayCount / env.VIDEO_DAILY_RENDER_CAP) * 100)}%`,
                background: todayCount >= env.VIDEO_DAILY_RENDER_CAP ? "var(--rose)" : "var(--amber)",
              }}
            />
          </div>
          <span className="font-mono text-xs font-bold tabular-nums shrink-0">
            {todayCount}/{env.VIDEO_DAILY_RENDER_CAP} renders · est ${todaySpend.toFixed(2)}
          </span>
        </div>
        <p className="text-[11px] text-[var(--mute)] mt-1.5">
          The cap counts every scene render. Package videos from a published post&apos;s Distribute tab, or let
          autopilot do it — <Link href="/blog/automation" className="underline">Automation</Link>.
        </p>
      </div>

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
                <Link href={`/videos/${r.id}`} className="text-sm font-bold flex-1 min-w-0 truncate hover:underline">{r.title}</Link>
                <span className="font-mono text-[10px] text-[var(--mute)]">
                  {r.provider} · {r.seconds}s · {r.aspect} · est ${r.costEstimate.toFixed(2)}
                </span>
                <Link href={`/videos/${r.id}`} className="btn sm">Storyboard</Link>
                {editor && r.status === "failed" && (
                  <form action={retryRenderAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn sm" pendingText="Queuing…">Retry</SubmitButton>
                  </form>
                )}
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
