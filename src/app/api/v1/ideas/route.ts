import { NextRequest, NextResponse } from "next/server";
import { apiCaller } from "@/lib/api-auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  // A token or a session (E-SEC-16), rate-limited either way (E-SEC-10).
  const c = await apiCaller(req, "read");
  if ("denied" in c) return c.denied;
  const workspace = { id: c.caller.workspaceId };
  const channelId = req.nextUrl.searchParams.get("channelId");
  const ideas = await db.idea.findMany({
    where: { channel: { workspaceId: workspace.id }, ...(channelId ? { channelId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, channelId: true, title: true, topic: true, strategy: true,
      outlierScore: true, suggestedLength: true, status: true, merit: true, createdAt: true,
    },
  });
  return NextResponse.json({ ideas });
}
