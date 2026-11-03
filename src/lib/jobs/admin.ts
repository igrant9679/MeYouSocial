import { db } from "@/lib/db";

/**
 * Settings → Jobs (E-ENG-17): this workspace's background queue — what is
 * waiting, running, retrying or gave up — with retry and cancel. Read here;
 * the actions are in app/actions/jobs-admin.ts.
 */

/** People's names for the queue's jobs; an unknown one shows its raw name. */
export const JOB_LABELS: Record<string, string> = {
  "agent.run": "Script agent run",
  "blog.finishdraft": "Finish an article draft",
  "analytics.backfill": "Pull 16 months of analytics history",
  "brand.extractdoc": "Read a brand document",
  "onboarding.audience": "Build a channel's audience avatar",
  "onboarding.ideas": "Starter ideas for a channel",
  "onboarding.voice": "Train a channel's voice",
  "social.autoimage": "Make a social post's image",
  "video.render": "Render a video board",
};
export const jobLabel = (name: string) => JOB_LABELS[name] ?? name;

export const JOB_FILTERS = ["attention", "queued", "running", "failed", "done"] as const;
export type JobFilter = (typeof JOB_FILTERS)[number];
export const asJobFilter = (v: string | undefined): JobFilter => (JOB_FILTERS as readonly string[]).includes(v ?? "") ? (v as JobFilter) : "attention";

/** Counts and up to 100 rows for one filter. "attention" = running, retrying, or failed this week. */
export async function jobsOverview(workspaceId: string, filter: JobFilter) {
  const week = new Date(Date.now() - 7 * 86_400_000);
  const day = new Date(Date.now() - 86_400_000);
  const [queued, running, failed, done] = await Promise.all([
    db.job.count({ where: { workspaceId, state: "queued" } }),
    db.job.count({ where: { workspaceId, state: "running" } }),
    db.job.count({ where: { workspaceId, state: "failed", finishedAt: { gte: week } } }),
    db.job.count({ where: { workspaceId, state: "done", finishedAt: { gte: day } } }),
  ]);
  const where = filter === "attention"
    ? { workspaceId, OR: [{ state: "running" }, { state: "queued", attempts: { gt: 0 } }, { state: "failed", finishedAt: { gte: week } }] }
    : { workspaceId, state: filter };
  const rows = await db.job.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, state: true, attempts: true, maxAttempts: true, error: true, lastLog: true, progress: true, runAfter: true, createdAt: true, finishedAt: true },
  });
  const now = Date.now();
  return {
    counts: { queued, running, failed, done },
    rows: rows.map((r) => ({ ...r, label: jobLabel(r.name), waiting: r.state === "queued" && !!r.runAfter && r.runAfter.getTime() > now })),
  };
}
