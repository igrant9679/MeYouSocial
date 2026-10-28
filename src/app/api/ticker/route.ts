import { auth } from "@/auth";
import { activeWorkspaceIdFor } from "@/lib/acl";
import { tickerEvents } from "@/lib/dashboard-data";
import { isGloballyPaused } from "@/lib/governance";
import { isFullyAutonomous } from "@/lib/autonomy";
import { readHeartbeat } from "@/lib/engine-heartbeat";

// Feed for the header status pill (EngineStatus). Polled by the client every
// 60s — returns 401 JSON (never a redirect) so the poller can just stop
// quietly. The path kept its name so a tab held open across the deploy that
// replaced the ticker keeps polling something that exists.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ events: [] }, { status: 401 });
  // The workspace being looked at (ENG-19): the first membership showed a
  // multi-company user another tenant's engine, with links that 404.
  const workspaceId = await activeWorkspaceIdFor(session.user.id);
  if (!workspaceId) return Response.json({ events: [] });
  const [events, paused, autonomous, heartbeat] = await Promise.all([
    tickerEvents(workspaceId, 12),
    isGloballyPaused(workspaceId),
    isFullyAutonomous(workspaceId),
    readHeartbeat(workspaceId).catch(() => null),
  ]);
  return Response.json({ events, state: { paused, autonomous, heartbeat, autopilotOff: process.env.AUTOPILOT === "off" } });
}
