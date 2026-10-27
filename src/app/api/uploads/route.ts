import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

// / — Upload a file (≤ 10MB) and add it as research / context.
// Reads text (.txt/.md/.json/.csv) and images (.jpg/.png/.gif/.webp, captioned by a vision model).
// PDF and Word are recognised and refused with a message — no parser is installed.

const MAX_BYTES = 10 * 1024 * 1024;
const TYPE_MAP: Record<string, "pdf" | "word" | "text" | "image"> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
  "application/json": "text",
  "image/jpeg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
};

const schema = z.object({
  channelId: z.string().optional(),
  scriptId: z.string().optional(),
  chatId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const { workspace, user } = await requireRole("EDITOR");
  const form = await req.formData();
  const parsed = schema.safeParse({
    channelId: form.get("channelId") ?? undefined,
    scriptId: form.get("scriptId") ?? undefined,
    chatId: form.get("chatId") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (>10MB)" }, { status: 400 });
  const kind = TYPE_MAP[file.type];
  if (!kind) return NextResponse.json({ error: "unsupported type" }, { status: 400 });
  // ⚠ No PDF or Word parser is installed, and a stub sentence stored as the
  // file's "content" was then handed to the model as research (ENG-14).
  // Refuse before anything is stored, and say what works instead.
  if (kind === "pdf" || kind === "word") {
    return NextResponse.json(
      { error: `${kind === "pdf" ? "PDF" : "Word"} files can't be read here yet. Paste the text you need, or save it as .txt or .md and upload that.` },
      { status: 415 },
    );
  }

  // ⚠ Every id from the form is this workspace's, or it is refused — before
  // anything is stored or paid for. The channel, chat and script used to be
  // taken on trust, which wrote research sources into another company's
  // assistant context (audit SEC-18).
  const chat = parsed.data.chatId
    ? await db.chat.findFirst({ where: { id: parsed.data.chatId, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } })
    : null;
  const script = parsed.data.scriptId
    ? await db.script.findFirst({ where: { id: parsed.data.scriptId, channel: { workspaceId: workspace.id } }, select: { id: true, channelId: true } })
    : null;
  const channel = parsed.data.channelId
    ? await db.channel.findFirst({ where: { id: parsed.data.channelId, workspaceId: workspace.id }, select: { id: true } })
    : null;
  if ((parsed.data.chatId && !chat) || (parsed.data.scriptId && !script) || (parsed.data.channelId && !channel)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const channelId = channel?.id ?? chat?.channelId ?? script?.channelId ?? null;
  if (!channelId) return NextResponse.json({ error: "no channel context" }, { status: 400 });
  if ((chat && chat.channelId !== channelId) || (script && script.channelId !== channelId)) {
    return NextResponse.json({ error: "the chat, script and channel don't belong together" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storage.put(file.name, bytes, file.type);

  // Extract usable text: text files are read; an image is LOOKED AT by a vision
  // model. The caption used to be written from the filename alone and stored
  // as if someone had seen the picture (ENG-14). No vision key → no caption,
  // and the response says so.
  let extractedText: string | null = null;
  let note: string | null = null;
  if (kind === "text") {
    extractedText = bytes.toString("utf8").slice(0, 50_000);
  } else {
    try {
      const { askAboutImage } = await import("@/lib/vision");
      extractedText = (await askAboutImage(
        { bytes, mimeType: file.type, source: file.name },
        "Describe what this image shows in one or two plain sentences. Name only what is visible; don't guess at brands, people or places you can't see.",
        workspace.id,
      )).slice(0, 600);
    } catch {
      note = "Stored without a caption: no vision-capable key (Google or OpenAI) is set for this workspace, so nothing looked at it.";
    }
  }
  const words = extractedText ? (extractedText.match(/[\p{L}\p{N}]+/gu) ?? []).length : 0;

  // Persist as a ResearchSource and (optionally) attach to the chat context.
  const research = await db.researchSource.create({
    data: {
      channelId,
      scriptId: script?.id ?? null,
      kind,
      ref: stored.key,
      title: file.name,
      content: extractedText,
      wordCount: words,
    },
  });
  if (chat) {
    await db.chatContext.create({
      data: {
        chatId: chat.id,
        kind: "upload",
        ref: research.id,
        metadata: JSON.stringify({ title: file.name, mime: file.type, size: file.size, words }),
      },
    });
  }
  await db.usageLog.create({
    data: { workspaceId: workspace.id, actorId: user.id, action: "upload", words },
  });

  return NextResponse.json({ ok: true, id: research.id, words, title: file.name, ...(note ? { note } : {}) });
}
