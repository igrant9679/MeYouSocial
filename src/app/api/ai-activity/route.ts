import { auth } from "@/auth";
import { db } from "@/lib/db";
import { cookies } from "next/headers";
import { ACTIVE_WS_COOKIE } from "@/lib/acl";

/**
 * Feed for the header's AI-activity indicator. Polled by the client every few
 * seconds while the tab is visible — returns 401 JSON (never a redirect) so
 * the poller can just stop quietly, same contract as /api/ticker.
 *
 * Reports the ACTIVE workspace's in-flight generations: durable Job rows
 * (queued/running) plus video renders mid-flight, and — deliberately — jobs
 * that finished in the last ~25s, so the client can SEE the running→done
 * transition and refresh the page data at that moment rather than the user
 * reloading by hand.
 */

export const dynamic = "force-dynamic";

const JOB_LABELS: Record<string, string> = {
  "social.autoimage": "Generating a post image",
  "agent.run": "Agent writing a script",
  "onboarding.voice": "Training the voice profile",
  "onboarding.audience": "Building the audience avatar",
  "onboarding.ideas": "Generating starter ideas",
};

const RECENT_MS = 25_000;

export type AiActivityItem = {
  id: string;
  label: string;
  state: "queued" | "running" | "done" | "failed";
  /** 0..1, or null for work with no measurable progress (video renders). */
  progress: number | null;
  detail: string | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ items: [] }, { status: 401 });

  // The ACTIVE workspace (cookie), not the first membership — an operator with
  // three companies must see the activity of the one they're looking at.
  const memberships = await db.membership.findMany({
    where: { userId: session.user.id, status: "active" },
    select: { workspaceId: true },
  });
  if (memberships.length === 0) return Response.json({ items: [] });
  const wanted = (await cookies()).get(ACTIVE_WS_COOKIE)?.value;
  const workspaceId = memberships.some((m) => m.workspaceId === wanted)
    ? wanted!
    : memberships[0].workspaceId;

  const since = new Date(Date.now() - RECENT_MS);
  const [jobs, renders] = await Promise.all([
    db.job.findMany({
      where: {
        workspaceId,
        OR: [
          { state: { in: ["queued", "running"] } },
          { state: { in: ["done", "failed"] }, finishedAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 12,
      select: { id: true, name: true, state: true, progress: true, lastLog: true, error: true },
    }),
    db.videoRender.findMany({
      where: { workspaceId, status: "rendering" },
      select: { id: true, title: true },
      take: 4,
    }),
  ]);

  const items: AiActivityItem[] = [
    ...jobs.map((j) => ({
      id: j.id,
      label: JOB_LABELS[j.name] ?? j.name,
      state: (j.state === "done" || j.state === "failed" ? j.state : j.state === "queued" ? "queued" : "running") as AiActivityItem["state"],
      progress: j.state === "queued" ? 0 : j.progress ?? null,
      detail: j.state === "failed" ? (j.error?.slice(0, 140) ?? null) : (j.lastLog?.slice(0, 140) ?? null),
    })),
    ...renders.map((r) => ({
      id: r.id,
      label: `Rendering video — ${r.title.slice(0, 40)}`,
      state: "running" as const,
      progress: null, // Veo gives no progress signal; the bar shows indeterminate
      detail: null,
    })),
  ];
  return Response.json({ items });
}
