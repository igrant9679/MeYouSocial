import { NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

// GET /api/scripts/[id]/agent/[runId] — return current agent run state for polling.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const { workspace } = await requireMembership();
  const run = await db.agentRun.findFirst({
    where: { id: runId, script: { id, channel: { workspaceId: workspace.id } } },
  });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  let steps: unknown = [];
  try { steps = JSON.parse(run.steps); } catch {}

  return NextResponse.json({
    id: run.id,
    status: run.status,
    progress: run.progress,
    steps,
    error: run.error,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
  });
}
