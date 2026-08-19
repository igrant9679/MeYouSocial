"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeJson } from "@/lib/db/json";
import { runAssistant } from "@/lib/assistant/run";

/**
 * The cross-app assistant.
 *
 * EDITOR, like every other way of creating content here — the tools it can
 * reach all land at the same review gates an editor's own clicks would, and
 * none of them publish, send, configure or delete (see assistant/tools.ts).
 *
 * ⚠ The turn runs INSIDE the action rather than in a job, because the person is
 * sitting there watching for the reply. That caps what it can be asked to do:
 * `draft_article` alone is a minute or two, and the loop allows six steps. If
 * this ever needs to run longer than a request can be held open, it becomes a
 * job with the thread as its ledger — the transcript is already the right shape
 * for that.
 */

export async function sendAssistantMessageAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  const threadId = String(formData.get("threadId") ?? "").trim();
  if (!message) redirect(threadId ? `/assistant/${threadId}` : "/assistant");

  // One thread per conversation; a new one starts when there's no id.
  const thread = threadId
    ? await db.assistantThread.findFirst({ where: { id: threadId, workspaceId: workspace.id, userId: user.id } })
    : await db.assistantThread.create({
        data: { workspaceId: workspace.id, userId: user.id, title: message.slice(0, 80) },
      });
  if (!thread) redirect("/assistant");

  const prior = await db.assistantMessage.findMany({
    where: { threadId: thread!.id },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { role: true, content: true },
  });

  await db.assistantMessage.create({ data: { threadId: thread!.id, role: "user", content: message } });

  const result = await runAssistant(
    { workspaceId: workspace.id, userId: user.id },
    prior.map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content })),
    message,
  );

  // A refusal or a broken run is still a turn: record what the user was told,
  // so the transcript never has a question with no answer under it.
  await db.assistantMessage.create({
    data: {
      threadId: thread!.id,
      role: "assistant",
      content: result.error && !result.answer ? result.error : result.answer,
      steps: writeJson(result.steps),
    },
  });
  await db.assistantThread.update({ where: { id: thread!.id }, data: { updatedAt: new Date() } });

  revalidatePath("/assistant", "layout");
  redirect(`/assistant/${thread!.id}`);
}

export async function newAssistantThreadAction() {
  await requireRole("EDITOR");
  redirect("/assistant");
}
