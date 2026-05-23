"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { llm } from "@/lib/llm";
import { getActiveChannel } from "@/lib/channel";

/** FR-CHAT-01 — Channel-scoped: require active channel before chatting. */
export async function createChatAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  let channelId = String(formData.get("channelId") ?? "");
  if (!channelId) {
    const { active } = await getActiveChannel();
    if (!active) redirect("/onboarding/channel/new");
    channelId = active!.id;
  }
  const ok = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!ok) redirect("/chat");

  const chat = await db.chat.create({
    data: { channelId, userId: user.id, type: "ideation" },
  });
  redirect(`/chat/${chat.id}`);
}

const postSchema = z.object({
  chatId: z.string(),
  content: z.string().min(1).max(10_000),
});

/** FR-CHAT-02/11 — Post a message, gather context, get an LLM response with conversation history. */
export async function postMessageAction(formData: FormData) {
  const parsed = postSchema.safeParse({
    chatId: formData.get("chatId"),
    content: formData.get("content"),
  });
  if (!parsed.success) return;
  const { user, workspace } = await requireRole("EDITOR");

  const chat = await db.chat.findFirst({
    where: { id: parsed.data.chatId, channel: { workspaceId: workspace.id } },
    include: { channel: { include: { voiceProfiles: { where: { isDefault: true } }, audience: true } }, messages: { orderBy: { createdAt: "asc" }, take: 30 }, contextItems: true },
  });
  if (!chat) return;

  // Persist user message
  await db.chatMessage.create({
    data: { chatId: chat.id, role: "user", content: parsed.data.content },
  });

  // Detect intent (FR-CHAT-10 — "turn this into a script" creates a Script + opens Canvas)
  const turnIntoScript = /turn (this|that|it) into (a |the )?script|make (this|that|it) a script|write (this|that) (as|into) a script/i.test(parsed.data.content);

  // Build system + context preamble (FR-AUD-05 — audience injected into chat)
  const voice = chat.channel.voiceProfiles[0];
  const audienceKQ = readJson<string[]>(chat.channel.audience?.keyQuestions ?? null, []);
  const contextLines = chat.contextItems.map((c) => `[${c.kind}] ${c.ref}`).join("\n");

  const system = `You are an editor for the YouTube channel "${chat.channel.name}" (niche: ${chat.channel.nicheDescription}).
Differentiation: ${chat.channel.differentiation ?? "—"}
Audience key questions: ${audienceKQ.slice(0, 5).join(" · ")}
Voice profile (truncated): ${(voice?.data ?? "").slice(0, 600)}
Attached context items:
${contextLines || "(none)"}`;

  const history = chat.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const reply = await llm.complete({
    model: chat.channel.defaultModel ?? "claude-sonnet",
    system,
    messages: [...history, { role: "user", content: parsed.data.content }],
  });

  await db.chatMessage.create({
    data: { chatId: chat.id, role: "assistant", content: reply.content, model: reply.model },
  });

  if (turnIntoScript) {
    // FR-CHAT-10 — spin a Script project from the conversation so far and redirect.
    const synthesis = await llm.complete({
      model: chat.channel.defaultModel ?? "claude-sonnet",
      system: "Synthesize the discussion into a working script title.",
      messages: history.concat([{ role: "user", content: parsed.data.content }]),
    });
    const title = synthesis.content.split("\n")[0].slice(0, 120) || "Untitled script";

    const script = await db.script.create({
      data: {
        channelId: chat.channelId,
        authorId: user.id,
        title,
        workflow: "canvas",
        language: chat.channel.defaultLanguage,
      },
    });
    await db.chat.update({ where: { id: chat.id }, data: { scriptId: script.id, type: "canvas" } });
    redirect(`/scripts/${script.id}`);
  }

  revalidatePath(`/chat/${chat.id}`);
}

const contextSchema = z.object({
  chatId: z.string(),
  kind: z.enum(["youtube_url", "web_url", "text"]),
  ref: z.string().min(1).max(4000),
});

/** FR-CHAT-02/03 — Attach a YouTube URL / web URL / pasted text as conversation context. */
export async function addChatContextAction(formData: FormData) {
  const parsed = contextSchema.safeParse({
    chatId: formData.get("chatId"),
    kind: formData.get("kind"),
    ref: formData.get("ref"),
  });
  if (!parsed.success) return;
  const { workspace } = await requireRole("EDITOR");
  const chat = await db.chat.findFirst({ where: { id: parsed.data.chatId, channel: { workspaceId: workspace.id } } });
  if (!chat) return;
  await db.chatContext.create({
    data: { chatId: chat.id, kind: parsed.data.kind, ref: parsed.data.ref },
  });
  revalidatePath(`/chat/${chat.id}`);
}
