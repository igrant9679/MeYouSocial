import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { runAssistant, type AssistantResult, type AssistantStep, type PendingAction, type TurnLive } from "@/lib/assistant/run";
import { outsideIn } from "@/lib/assistant/tools";

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
  /** The nonce a confirm card's Yes carried (E-ENG-01); absent for anything typed. */
  confirm?: string | null;
  /** E-ENG-12: hear the thread id as soon as it exists, and each step as it runs. */
  live?: { onThread?: (threadId: string) => void; onProgress?: TurnLive["onProgress"] };
};

/** `messageId`: the stored reply — what an Undo names (E-ENG-09). */
export type TurnOutput = { threadId: string; messageId: string; result: AssistantResult };

export async function runTurn(input: TurnInput): Promise<TurnOutput | null> {
  const message = input.message.trim().slice(0, 4000);
  if (!message) return null;

  const thread = input.threadId
    ? await db.assistantThread.findFirst({ where: { id: input.threadId, workspaceId: input.workspaceId, userId: input.userId } })
    : await db.assistantThread.create({ data: { workspaceId: input.workspaceId, userId: input.userId, title: message.slice(0, 80) } });
  if (!thread) return null;
  input.live?.onThread?.(thread.id);
  // Stop applies to a press made after this turn began, never to an old one.
  const startedAt = new Date();
  const shouldStop = async () => {
    const t = await db.assistantThread.findUnique({ where: { id: thread.id }, select: { stopRequestedAt: true } });
    return !!t?.stopRequestedAt && t.stopRequestedAt >= startedAt;
  };

  // The NEWEST twenty, in order (ENG-11): ascending + take kept the opening
  // exchange forever, so after twenty messages the model never saw the
  // question it had just asked.
  const prior = (await db.assistantMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { role: true, content: true, steps: true },
  })).reverse();
  // Outside text an earlier step brought in, among the messages the model
  // still sees (run.ts keeps the last twelve) — the rules hold until it's gone (E-ENG-02).
  const carriedOutside = [...new Set(prior.slice(-12).flatMap((m) =>
    readJson<AssistantStep[]>(m.steps, []).flatMap((s) => (s.kind === "tool" && s.ok ? [outsideIn(s.tool, s.output)] : [])).filter((x): x is string => !!x),
  ))];

  await db.assistantMessage.create({ data: { threadId: thread.id, role: "user", content: message } });

  // Claim the waiting proposal ATOMICALLY before acting on it. Clearing it only
  // after the run let a double "yes" (two tabs, a retry, the dock and the full
  // page) run a confirm tool twice, and a crash mid-run left it waiting for the
  // next "ok". Whoever clears it is the one turn allowed to answer it.
  let pending: PendingAction | null = null;
  if (thread.pending) {
    const claimed = await db.assistantThread.updateMany({
      where: { id: thread.id, pending: thread.pending },
      data: { pending: null },
    });
    if (claimed.count === 1) pending = readJson<PendingAction | null>(thread.pending, null);
  }
  const result = await runAssistant(
    { workspaceId: input.workspaceId, userId: input.userId, role: input.role, page: input.page ?? null, channelId: input.channelId ?? null, threadId: thread.id },
    prior.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    message,
    pending,
    input.confirm ?? null,
    { outside: carriedOutside },
    { onProgress: input.live?.onProgress, shouldStop },
  );

  // A refusal or a broken run is still a turn: record what the person was
  // told, so the transcript never has a question with no answer under it.
  const reply = await db.assistantMessage.create({
    data: {
      threadId: thread.id,
      role: "assistant",
      content: result.error && !result.answer ? result.error : result.answer,
      steps: writeJson(result.steps),
      // E-ENG-07: what the reply took; null when no model call was counted (a card's stale Yes).
      inputTokens: result.usage?.calls ? result.usage.inputTokens : null,
      outputTokens: result.usage?.calls ? result.usage.outputTokens : null,
    },
  });
  await db.assistantThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date(), pending: result.pending ? writeJson(result.pending) : null },
  });

  return { threadId: thread.id, messageId: reply.id, result };
}
