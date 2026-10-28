import { NextRequest, NextResponse } from "next/server";
import { requireMembership, requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { softLimitProblem } from "@/lib/soft-limits";

// GET /api/v1/scripts — list scripts (optional ?channelId).
// POST /api/v1/script — create a draft.

export async function GET(req: NextRequest) {
  const { workspace } = await requireMembership();
  const channelId = req.nextUrl.searchParams.get("channelId");
  const scripts = await db.script.findMany({
    where: {
      channel: { workspaceId: workspace.id },
      ...(channelId ? { channelId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true, title: true, status: true, wordCount: true, durationSeconds: true,
      channelId: true, workflow: true, language: true, model: true, templateId: true,
      createdAt: true, updatedAt: true,
    },
  });
  return NextResponse.json({ scripts });
}

export async function POST(req: NextRequest) {
  const { workspace, user } = await requireRole("EDITOR");
  const body = await req.json().catch(() => null);
  if (!body || typeof body.channelId !== "string" || typeof body.title !== "string") {
    return NextResponse.json({ error: "channelId and title are required" }, { status: 400 });
  }
  const channel = await db.channel.findFirst({ where: { id: body.channelId, workspaceId: workspace.id } });
  if (!channel) return NextResponse.json({ error: "channel not found" }, { status: 404 });
  const limit = await softLimitProblem("script", workspace.id, user.id);
  if (limit) return NextResponse.json({ error: limit }, { status: 429 });

  const script = await db.script.create({
    data: {
      channelId: channel.id,
      authorId: user.id,
      title: String(body.title).slice(0, 200),
      workflow: body.workflow === "builder" ? "builder" : "canvas",
      language: channel.defaultLanguage,
      model: channel.defaultModel,
    },
  });
  return NextResponse.json({ id: script.id, title: script.title }, { status: 201 });
}
