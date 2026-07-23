import { auth } from "@/auth";
import { db } from "@/lib/db";
import { tickerEvents } from "@/lib/dashboard-data";

// Feed for the header ticker. Polled by the client every 60s — returns 401
// JSON (never a redirect) so the poller can just stop quietly.

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ events: [] }, { status: 401 });
  const membership = await db.membership.findFirst({
    where: { userId: session.user.id, status: "active" },
    select: { workspaceId: true },
  });
  if (!membership) return Response.json({ events: [] });
  const events = await tickerEvents(membership.workspaceId, 12);
  return Response.json({ events });
}
