import { NextRequest, NextResponse } from "next/server";
import { requireMembership } from "@/lib/acl";
import { db } from "@/lib/db";

/** GET /api/uploads/sources/<id> — how the reading of an attached file is going (E-ENG-13). */

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workspace } = await requireMembership();
  const source = await db.researchSource.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    select: { readState: true, readNote: true, wordCount: true },
  });
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ state: source.readState, note: source.readNote, words: source.wordCount });
}
