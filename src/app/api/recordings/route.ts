import { NextResponse } from "next/server";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { writeAudit } from "@/lib/governance";

/**
 * POST /api/recordings — a take recorded in the browser at the teleprompter
 * (E-VID-14): saved to storage as the workspace's file, made an Asset of the
 * script's channel (kind "upload", source "recording"), and linked to the
 * script's project so the Edit Bay finds it. EDITOR, like any upload.
 *
 * ⚠ The bytes are checked, not the declared type: a WebM (EBML) or MP4/MOV
 *   (ftyp box) only, up to MAX_BYTES — a browser can claim anything.
 */

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/** WebM/Matroska or MP4/MOV, from the first bytes. Pure. */
function videoKind(b: Buffer): "webm" | "mp4" | null {
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 12 && b.toString("ascii", 4, 8) === "ftyp") return "mp4";
  return null;
}

export async function POST(req: Request) {
  const { workspace, user } = await requireRole("EDITOR");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const scriptId = String(form?.get("scriptId") ?? "");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: "No recording came through." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "That take is over 200 MB — record a shorter one, or upload it to Assets from a file." }, { status: 413 });
  const script = await db.script.findFirst({ where: { id: scriptId, channel: { workspaceId: workspace.id } }, select: { id: true, title: true, channelId: true, contentProject: { select: { id: true } } } });
  if (!script) return NextResponse.json({ ok: false, error: "That script isn't in this workspace." }, { status: 404 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = videoKind(bytes);
  if (!kind) return NextResponse.json({ ok: false, error: "That isn't a video the app can keep (WebM or MP4)." }, { status: 415 });
  const takes = await db.asset.count({ where: { workspaceId: workspace.id, source: "recording", tags: { contains: `"script:${script.id}"` } } });
  const name = `Take ${takes + 1} — ${script.title}`.slice(0, 200);
  const stored = await storage.put(`take-${takes + 1}.${kind}`, bytes, kind === "webm" ? "video/webm" : "video/mp4", workspace.id);
  const asset = await db.asset.create({
    data: {
      workspaceId: workspace.id,
      channelId: script.channelId,
      kind: "upload",
      name,
      url: stored.url,
      uploadKey: stored.key,
      source: "recording",
      tags: JSON.stringify(["recording", `script:${script.id}`]),
      ...(script.contentProject ? { links: { create: [{ contentProjectId: script.contentProject.id }] } } : {}),
    },
  });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "video.take_recorded", entityType: "asset", entityId: asset.id, meta: { scriptId: script.id, bytes: bytes.byteLength, kind, linked: !!script.contentProject } });
  return NextResponse.json({ ok: true, assetId: asset.id, name, url: stored.url, linked: !!script.contentProject });
}
