import { NextRequest, NextResponse } from "next/server";
import { apiCaller } from "@/lib/api-auth";
import { db } from "@/lib/db";

// GET /api/v1/channels — list channels for the calling user's workspace.

export async function GET(req: NextRequest) {
  // A token or a session (E-SEC-16), rate-limited either way (E-SEC-10).
  const c = await apiCaller(req, "read");
  if ("denied" in c) return c.denied;
  const workspace = { id: c.caller.workspaceId };
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
