import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { CHUNK_BYTES, contentProblem, type UploadKind } from "@/lib/documents/kinds";
import { registerResearchReadJobs } from "@/lib/jobs/research-read";
import { dropUpload, UploadBusy, UploadGone, uploadStatus, writePiece } from "@/lib/storage/chunked";

/**
 * One upload (E-ENG-13): PUT a piece, GET how much arrived, POST when it's all
 * there, DELETE to give up. Only the person who started it, and only an editor.
 */

export const dynamic = "force-dynamic";

async function load(params: Promise<{ id: string }>) {
  const { id } = await params;
  const { workspace, user } = await requireRole("EDITOR");
  const session = await db.uploadSession.findFirst({ where: { id, workspaceId: workspace.id, userId: user.id } });
  return { session, user, workspace };
}

const GONE = () => NextResponse.json({ error: "This upload has expired. Attach the file again." }, { status: 410 });
const BUSY = () => NextResponse.json({ retry: true, error: "Storage isn't answering." }, { status: 503 });

/** The body, up to `max` bytes; null past that, without reading the rest. */
async function bodyUpTo(req: NextRequest, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session } = await load(params);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.sourceId || session.storedKey) return NextResponse.json({ received: Number(session.size) });
  try {
    const { received, key } = await uploadStatus(session);
    await db.uploadSession.update({ where: { id: session.id }, data: { received: BigInt(received), ...(key ? { storedKey: key } : {}) } });
    return NextResponse.json({ received });
  } catch (e) {
    if (e instanceof UploadBusy) return BUSY();
    if (e instanceof UploadGone) {
      await db.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
      return GONE();
    }
    throw e;
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session } = await load(params);
  if (!session) return NextResponse.json({ error: "This upload has expired. Attach the file again." }, { status: 410 });

  const received = Number(session.received);
  const size = Number(session.size);
  // A piece that isn't next: its reply was lost, or it's a duplicate. The answer says where to go on from.
  const offset = Number(req.nextUrl.searchParams.get("offset"));
  if (!Number.isSafeInteger(offset) || offset !== received) return NextResponse.json({ received, error: "out of step" }, { status: 409 });

  const bytes = await bodyUpTo(req, CHUNK_BYTES);
  if (!bytes) return NextResponse.json({ error: "That piece is too big." }, { status: 413 });
  const last = offset + bytes.byteLength === size;
  // Drive takes pieces in multiples of 256 KiB: anything but a full one must be the last.
  if (bytes.byteLength === 0 || offset + bytes.byteLength > size || (!last && bytes.byteLength !== CHUNK_BYTES)) {
    return NextResponse.json({ error: "That piece isn't the right size." }, { status: 400 });
  }
  if (offset === 0) {
    const problem = contentProblem(session.kind as UploadKind, bytes.subarray(0, 8192), session.name);
    if (problem) {
      await dropUpload(session);
      await db.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
      return NextResponse.json({ error: problem }, { status: 415 });
    }
  }

  try {
    const out = await writePiece(session, offset, bytes);
    await db.uploadSession.updateMany({
      where: { id: session.id, received: session.received },
      data: { received: BigInt(out.received), ...(out.key ? { storedKey: out.key } : {}) },
    });
    return NextResponse.json({ received: out.received });
  } catch (e) {
    if (e instanceof UploadBusy) return BUSY();
    if (e instanceof UploadGone) {
      await dropUpload(session);
      await db.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
      return GONE();
    }
    // A named refusal (out of Google storage, a folder it can't write to): another try won't help.
    return NextResponse.json({ error: e instanceof Error ? e.message : "The file couldn't be stored." }, { status: 502 });
  }
}

/** It's all there: the file becomes research, and is read in the background. Asking twice finds the same one. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session } = await load(params);
  if (!session) return GONE();
  if (session.sourceId) return NextResponse.json({ id: session.sourceId, title: session.name, reading: true });
  if (!session.storedKey) return NextResponse.json({ error: "The file hasn't all arrived yet.", received: Number(session.received) }, { status: 409 });

  const source = await db.$transaction(async (tx) => {
    const created = await tx.researchSource.create({
      data: {
        channelId: session.channelId,
        scriptId: session.scriptId,
        kind: session.kind,
        ref: session.storedKey!,
        title: session.name,
        bytes: session.size,
        readState: "reading",
      },
      select: { id: true },
    });
    if (session.chatId) {
      await tx.chatContext.create({
        data: { chatId: session.chatId, kind: "upload", ref: created.id, metadata: JSON.stringify({ title: session.name, mime: session.contentType, size: Number(session.size), words: 0 }) },
      });
    }
    await tx.uploadSession.update({ where: { id: session.id }, data: { sourceId: created.id } });
    return created;
  });
  registerResearchReadJobs();
  await jobs.enqueue("research.read", { sourceId: source.id, actorId: session.userId }, { refId: source.id, workspaceId: session.workspaceId });
  return NextResponse.json({ id: source.id, title: session.name, reading: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session } = await load(params);
  if (session && !session.sourceId) {
    await dropUpload(session);
    await db.uploadSession.delete({ where: { id: session.id } }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
