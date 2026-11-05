import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { CHUNK_BYTES, formatBytes, refusalFor, UPLOAD_MAX_BYTES, uploadKind } from "@/lib/documents/kinds";
import { beginUpload, dropUpload, UploadBusy, UploadGone, uploadStatus } from "@/lib/storage/chunked";

/**
 * POST /api/uploads/sessions — start attaching a file as research on a channel, a
 * script or a chat (E-ENG-13). The same person attaching the same file again
 * carries on where it stopped. The pieces go to /api/uploads/sessions/<id>.
 */

export const dynamic = "force-dynamic";

const OPEN_PER_PERSON = 5;
const WEEK_MS = 6 * 24 * 3600_000; // A day short of Drive's week, so a resumed upload has time to finish.

const schema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(200).default(""),
  lastModified: z.number().optional(),
  channelId: z.string().max(40).optional(),
  scriptId: z.string().max(40).optional(),
  chatId: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  const { workspace, user } = await requireRole("EDITOR");
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const { name, size, type, lastModified, chatId, scriptId, channelId: givenChannel } = parsed.data;

  const known = uploadKind(name, type);
  if (!known) return NextResponse.json({ error: refusalFor(name, type) }, { status: 415 });
  if (size > UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${formatBytes(size)}. The most that can be attached is ${formatBytes(UPLOAD_MAX_BYTES)}.` }, { status: 413 });
  }

  // ⚠ Every id from the form is this workspace's, or it is refused — before
  // anything is stored or paid for. The channel, chat and script used to be
  // taken on trust, which wrote research sources into another company's
  // assistant context (audit SEC-18).
  const chat = chatId ? await db.chat.findFirst({ where: { id: chatId, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } }) : null;
  const script = scriptId ? await db.script.findFirst({ where: { id: scriptId, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } }) : null;
  const channel = givenChannel ? await db.channel.findFirst({ where: { id: givenChannel, workspaceId: workspace.id }, select: { id: true } }) : null;
  if ((chatId && !chat) || (scriptId && !script) || (givenChannel && !channel)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const channelId = channel?.id ?? chat?.channelId ?? script?.channelId ?? null;
  if (!channelId) return NextResponse.json({ error: "no channel context" }, { status: 400 });
  if ((chat && chat.channelId !== channelId) || (script && script.channelId !== channelId)) {
    return NextResponse.json({ error: "the chat, script and channel don't belong together" }, { status: 400 });
  }

  // The same file, picked up again.
  const fingerprint = `${name}|${size}|${lastModified ?? ""}`;
  const earlier = await db.uploadSession.findFirst({
    where: { workspaceId: workspace.id, userId: user.id, fingerprint, channelId, scriptId: scriptId ?? null, chatId: chatId ?? null, sourceId: null, updatedAt: { gt: new Date(Date.now() - WEEK_MS) } },
    orderBy: { updatedAt: "desc" },
  });
  if (earlier) {
    try {
      const { received, key } = await uploadStatus(earlier);
      if (key || received !== Number(earlier.received)) {
        await db.uploadSession.update({ where: { id: earlier.id }, data: { received: BigInt(received), ...(key ? { storedKey: key } : {}) } });
      }
      return NextResponse.json({ id: earlier.id, chunkSize: CHUNK_BYTES, received, resumed: received > 0 });
    } catch (e) {
      // Busy: it may well still be there, so it isn't thrown away for a blip.
      if (e instanceof UploadBusy) return NextResponse.json({ error: "Storage isn't answering. Try again in a minute." }, { status: 503 });
      if (!(e instanceof UploadGone)) throw e;
      await db.uploadSession.delete({ where: { id: earlier.id } }).catch(() => {});
    }
  }

  const limit = await hit("uploadsPerUser", user.id);
  if (!limit.ok) {
    return NextResponse.json({ error: `That's a lot of files in a short time. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.` }, { status: 429 });
  }
  // An upload someone walked away from holds nothing here, but a few are enough.
  const open = await db.uploadSession.findMany({ where: { workspaceId: workspace.id, userId: user.id, sourceId: null }, orderBy: { updatedAt: "asc" } });
  for (const s of open.slice(0, Math.max(0, open.length - OPEN_PER_PERSON + 1))) {
    await dropUpload(s);
    await db.uploadSession.delete({ where: { id: s.id } }).catch(() => {});
  }

  let target: { backend: string; remote: string | null };
  try {
    target = await beginUpload(name, known.contentType, size);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "The upload couldn't be started." }, { status: 502 });
  }
  const session = await db.uploadSession.create({
    data: {
      workspaceId: workspace.id, userId: user.id, channelId, scriptId: script?.id ?? null, chatId: chat?.id ?? null,
      name, contentType: known.contentType, kind: known.kind, size: BigInt(size), fingerprint, backend: target.backend, remote: target.remote,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: session.id, chunkSize: CHUNK_BYTES, received: 0 });
}
