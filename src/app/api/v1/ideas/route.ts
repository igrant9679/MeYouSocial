import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { hit, tooMany } from "@/lib/rate-limit";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { workspace, user } = await requireMembership();
  // E-SEC-10: the API is limited per person (RATE_LIMIT_PER_MINUTE).
  const limited = await hit("apiPerUser", user.id);
  if (!limited.ok) return tooMany(limited.retryAfter);
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
