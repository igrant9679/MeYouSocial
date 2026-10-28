import { auth } from "@/auth";
import { activeWorkspaceIdFor } from "@/lib/acl";
import { tickerEvents } from "@/lib/dashboard-data";
import { isGloballyPaused } from "@/lib/governance";
import { isFullyAutonomous } from "@/lib/autonomy";
import { readHeartbeat } from "@/lib/engine-heartbeat";
import { unreadCount } from "@/lib/notify";
import { stripCounts } from "@/lib/stage-counts";

// The header's one poll (E-SHL-01, components/ShellPoll.tsx): the engine pill's
// events and state, the unread bell and the stage strip's badges, for the
// workspace being looked at. 401 JSON when signed out (never a redirect), so the
// poller just stops. /api/ticker answers the same, for a tab held open across
// the deploy that brought this in.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ events: [] }, { status: 401 });
  const userId = session.user.id;
  // The workspace being looked at (ENG-19), not the first membership.
  const workspaceId = await activeWorkspaceIdFor(userId);
  if (!workspaceId) return Response.json({ events: [] });
  const [events, paused, autonomous, heartbeat, unread, counts] = await Promise.all([
    tickerEvents(workspaceId, 12),
    isGloballyPaused(workspaceId),
    isFullyAutonomous(workspaceId),
    readHeartbeat(workspaceId).catch(() => null),
    unreadCount(workspaceId, userId),
    stripCounts(workspaceId),
  ]);
  return Response.json({
    workspaceId,
    events,
    state: { paused, autonomous, heartbeat, autopilotOff: process.env.AUTOPILOT === "off" },
    unread,
    counts,
  });
}
