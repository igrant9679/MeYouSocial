import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { hit, tooMany } from "@/lib/rate-limit";
import { db } from "@/lib/db";

// GET /api/v1/channels — list channels for the calling user's workspace.

export async function GET() {
  const { workspace, user } = await requireMembership();
  // E-SEC-10: the API is limited per person (RATE_LIMIT_PER_MINUTE).
  const limited = await hit("apiPerUser", user.id);
  if (!limited.ok) return tooMany(limited.retryAfter);
  const channels = await db.channel.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, nicheDescription: true, presentationStyle: true,
      linkedYoutubeHandle: true, defaultLanguage: true, defaultModel: true,
      createdAt: true, updatedAt: true,
    },
  });
  return NextResponse.json({ channels });
}
