import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

/**
 * Stop a running assistant turn (E-ENG-12). Marks the person's own thread;
 * the turn checks between steps (lib/assistant/run.ts), so whatever step is
 * running finishes and nothing after it starts.
 */
export async function POST(req: Request) {
  const { user, workspace } = await requireMembership();
  const body = (await req.json().catch(() => ({}))) as { threadId?: string };
  const r = await db.assistantThread.updateMany({
    where: { id: String(body.threadId ?? "").slice(0, 40), workspaceId: workspace.id, userId: user.id },
    data: { stopRequestedAt: new Date() },
  });
  return Response.json({ ok: r.count === 1 }, { status: r.count === 1 ? 200 : 404 });
}
