import { NextRequest, NextResponse } from "next/server";
import { apiCaller } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { softLimitProblem } from "@/lib/soft-limits";

// GET /api/v1/scripts — list scripts (optional ?channelId).
// POST /api/v1/script — create a draft.

export async function GET(req: NextRequest) {
  // A token or a session (E-SEC-16), rate-limited either way (E-SEC-10).
  const c = await apiCaller(req, "read");
  if ("denied" in c) return c.denied;
  const workspace = { id: c.caller.workspaceId };
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
  // Writing needs a write token or an editor's session (E-SEC-16). A token acts as
  // the admin who made it — soft limits and authorship are theirs.
  const c = await apiCaller(req, "write");
  if ("denied" in c) return c.denied;
  const workspace = { id: c.caller.workspaceId };
  const user = { id: c.caller.userId ?? "" };
  if (!user.id) return NextResponse.json({ error: "This token has no owner any more — make a new one." }, { status: 403 });
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
