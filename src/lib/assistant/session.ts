import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { runAssistant, type AssistantResult, type PendingAction } from "@/lib/assistant/run";

/**
 * One assistant turn, persisted: the person's message, the run, the reply,
 * the steps, and the pending proposal (if the run stopped to ask for a yes).
 * Shared by the full-page action and the dock's API route so a conversation
 * started in one continues in the other.
 */
export type TurnInput = {
  workspaceId: string;
  userId: string;
  role: string;
  threadId?: string | null;
  message: string;
  /** The app path the person is on, so "walk me through this" has a this. */
  page?: string | null;
  /** The active YouTube channel — "my channel" in the conversation; where video ideas and scripts land. */
  channelId?: string | null;
};

export type TurnOutput = { threadId: string; result: AssistantResult };

export async function runTurn(input: TurnInput): Promise<TurnOutput | null> {
  const message = input.message.trim().slice(0, 4000);
  if (!message) return null;

  const thread = input.threadId
    ? await db.assistantThread.findFirst({ where: { id: input.threadId, workspaceId: input.workspaceId, userId: input.userId } })
    : await db.assistantThread.create({ data: { workspaceId: input.workspaceId, userId: input.userId, title: message.slice(0, 80) } });
  if (!thread) return null;

  const prior = await db.assistantMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { role: true, content: true },
  });

  await db.assistantMessage.create({ data: { threadId: thread.id, role: "user", content: message } });

  const pending = thread.pending ? readJson<PendingAction | null>(thread.pending, null) : null;
  const result = await runAssistant(
    { workspaceId: input.workspaceId, userId: input.userId, role: input.role, page: input.page ?? null, channelId: input.channelId ?? null },
    prior.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    message,
    pending,
  );

  // A refusal or a broken run is still a turn: record what the person was
  // told, so the transcript never has a question with no answer under it.
  await db.assistantMessage.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      content: result.error && !result.answer ? result.error : result.answer,
      steps: writeJson(result.steps),
    },
  });
  await db.assistantThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date(), pending: result.pending ? writeJson(result.pending) : null },
  });

  return { threadId: thread.id, result };
}
