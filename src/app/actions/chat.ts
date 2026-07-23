"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { llm } from "@/lib/llm";
import { getActiveChannel } from "@/lib/channel";

/** Channel-scoped: require active channel before chatting. */
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

/** Post a message, gather context, get an LLM response with conversation history. */
export async function postMessageAction(formData: FormData) {
  const parsed = postSchema.safeParse({
    chatId: formData.get("chatId"),
    content: formData.get("content"),
  });
  if (!parsed.success) return;
  const { user, workspace } = await requireRole("EDITOR");

  const chat = await db.chat.findFirst({
    where: { id: parsed.data.chatId, channel: { workspaceId: workspace.id } },
    include: {
      channel: {
        include: {
          voiceProfiles: { where: { isDefault: true } },
          audience: true,
          memory: { orderBy: { createdAt: "asc" } },
          research: { where: { starred: true }, take: 6, orderBy: { createdAt: "desc" } },
        },
      },
      messages: { orderBy: { createdAt: "asc" }, take: 30 },
      contextItems: true,
    },
  });
  if (!chat) return;

  // Persist user message
  await db.chatMessage.create({
    data: { chatId: chat.id, role: "user", content: parsed.data.content },
  });

  // Detect intent ( — "turn this into a script" creates a Script + opens Canvas)
  const turnIntoScript = /turn (this|that|it) into (a |the )?script|make (this|that|it) a script|write (this|that) (as|into) a script/i.test(parsed.data.content);

  // answer in-chat outlier requests via Intel data
  // quick web search
  let extraContext = "";
  if (/outlier|outliers|long-form outlier|top \d+ about/i.test(parsed.data.content)) {
    const { db } = await import("@/lib/db");
    const top = await db.intelVideo.findMany({
      where: { outlierScore: { gte: 2 } },
      orderBy: { outlierScore: "desc" },
      take: 10,
      include: { intelChannel: true },
    });
    extraContext += "\n[ outliers from indexed Intel]\n" + top.map((v) => `- ${v.outlierScore?.toFixed(1)}x ${v.title} (${v.intelChannel.name})`).join("\n");
  }
  const webMatch = parsed.data.content.match(/\/(search|web)\s+(.+)/i);
  if (webMatch) {
    const { getSearchProvider } = await import("@/lib/search");
    const { provider: webSearch } = await getSearchProvider(workspace.id);
    const results = await webSearch.search(webMatch[2], 5);
    extraContext += "\n[ quick web search]\n" + results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`).join("\n");
  }

  // Build system + context preamble ( — audience injected into chat)
  const voice = chat.channel.voiceProfiles[0];
  const audienceKQ = readJson<string[]>(chat.channel.audience?.keyQuestions ?? null, []);
  const contextLines = chat.contextItems.map((c) => `[${c.kind}] ${c.ref}`).join("\n");

  const memoryLines = chat.channel.memory.map((m) => `- ${m.body}`).join("\n");
  const starredResearch = chat.channel.research
    .map((r) => `### ${r.title ?? r.ref}\n${(r.content ?? "").slice(0, 600)}`)
    .join("\n\n");
  const system = `You are an editor for the YouTube channel "${chat.channel.name}" (niche: ${chat.channel.nicheDescription}).
Differentiation: ${chat.channel.differentiation ?? "—"}
Audience key questions: ${audienceKQ.slice(0, 5).join(" · ")}
Voice profile (truncated): ${(voice?.data ?? "").slice(0, 600)}
${memoryLines ? `\nChannel Memory (durable facts — ALWAYS respect these):\n${memoryLines}\n` : ""}
${starredResearch ? `\nStarred research (persisted across all scripts,):\n${starredResearch}\n` : ""}${extraContext}
Attached context items:
${contextLines || "(none)"}`;

  const history = chat.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const reply = await llm.complete({
    model: chat.channel.defaultModel ?? "claude-sonnet",
    system,
    messages: [...history, { role: "user", content: parsed.data.content }],
    workspaceId: workspace.id,
  });

  await db.chatMessage.create({
    data: { chatId: chat.id, role: "assistant", content: reply.content, model: reply.model },
  });

  if (turnIntoScript) {
    // spin a Script project from the conversation so far and redirect.
    const synthesis = await llm.complete({
      model: chat.channel.defaultModel ?? "claude-sonnet",
      system: "Synthesize the discussion into a working script title.",
      messages: history.concat([{ role: "user", content: parsed.data.content }]),
      workspaceId: workspace.id,
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

/** Attach a YouTube URL / web URL / pasted text as conversation context. */
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
