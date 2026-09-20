import { auth } from "@/auth";
import { db } from "@/lib/db";
import { tickerEvents } from "@/lib/dashboard-data";
import { isGloballyPaused } from "@/lib/governance";
import { isFullyAutonomous } from "@/lib/autonomy";

// Feed for the header status pill (EngineStatus). Polled by the client every
// 60s — returns 401 JSON (never a redirect) so the poller can just stop
// quietly. The path kept its name so a tab held open across the deploy that
// replaced the ticker keeps polling something that exists.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ events: [] }, { status: 401 });
  const membership = await db.membership.findFirst({
    where: { userId: session.user.id, status: "active" },
    select: { workspaceId: true },
  });
  if (!membership) return Response.json({ events: [] });
  const [events, paused, autonomous] = await Promise.all([
    tickerEvents(membership.workspaceId, 12),
    isGloballyPaused(membership.workspaceId),
    isFullyAutonomous(membership.workspaceId),
  ]);
  return Response.json({ events, state: { paused, autonomous } });
}
