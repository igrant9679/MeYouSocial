import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { llm } from "@/lib/llm";

// / — Upload a file (≤ 10MB) and add it as research / context.
// Accepts PDF, Word (.doc/.docx), text (.txt/.md/.json/.csv) and images (.jpg/.png/.gif/.webp).

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

  const bytes = Buffer.from(await file.arrayBuffer());
  const stored = await storage.put(file.name, bytes, file.type);

  // Extract usable text. For now: text/json/md/csv are read directly; PDF/Word/image are stubbed
  // (real implementation will wire up pdf-parse, mammoth, and image-captioning when keys are added).
  let extractedText: string | null = null;
  if (kind === "text") {
    extractedText = bytes.toString("utf8").slice(0, 50_000);
  } else if (kind === "image") {
    // Have the LLM describe what the image is meant to convey from the filename + caption hint.
    const captioned = await llm.complete({
      model: "claude-sonnet",
      system: "Generate a short caption (1-2 sentences) describing the likely subject of an image attachment, based only on its filename and surrounding context.",
      messages: [{ role: "user", content: `Filename: ${file.name}` }],
      workspaceId: workspace.id,
    });
    extractedText = captioned.content.slice(0, 600);
  } else {
    // PDF / Word — placeholder. Wire pdf-parse / mammoth here when ready.
    extractedText = `(${kind.toUpperCase()} attachment "${file.name}" — text extraction is stubbed in mock mode; real extraction will be wired when a parser is enabled.)`;
  }
  const words = (extractedText.match(/[\p{L}\p{N}]+/gu) ?? []).length;

  // Resolve the parent record
  let channelId = parsed.data.channelId ?? null;
  if (!channelId && parsed.data.chatId) {
    const chat = await db.chat.findFirst({ where: { id: parsed.data.chatId, channel: { workspaceId: workspace.id } } });
    if (chat) channelId = chat.channelId;
  }
  if (!channelId && parsed.data.scriptId) {
    const s = await db.script.findFirst({ where: { id: parsed.data.scriptId, channel: { workspaceId: workspace.id } } });
    if (s) channelId = s.channelId;
  }
  if (!channelId) return NextResponse.json({ error: "no channel context" }, { status: 400 });

  // Persist as a ResearchSource and (optionally) attach to the chat context.
  const research = await db.researchSource.create({
    data: {
      channelId,
      scriptId: parsed.data.scriptId ?? null,
      kind,
      ref: stored.key,
      title: file.name,
      content: extractedText,
      wordCount: words,
    },
  });
  if (parsed.data.chatId) {
    await db.chatContext.create({
      data: {
        chatId: parsed.data.chatId,
        kind: "upload",
        ref: research.id,
        metadata: JSON.stringify({ title: file.name, mime: file.type, size: file.size, words }),
      },
    });
  }
  await db.usageLog.create({
    data: { workspaceId: workspace.id, actorId: user.id, action: "upload", words },
  });

  return NextResponse.json({ ok: true, id: research.id, words, title: file.name });
}
