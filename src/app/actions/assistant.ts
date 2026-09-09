"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { runTurn } from "@/lib/assistant/session";
import { getActiveChannel } from "@/lib/channel";

/**
 * The full-page assistant. One turn runs INSIDE the action because the person
 * is watching for the reply; the dock's API route (app/api/assistant) runs the
 * same turn as JSON. Both persist through lib/assistant/session.ts, so a
 * conversation started in one continues in the other.
 */

export async function sendAssistantMessageAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  const threadId = String(formData.get("threadId") ?? "").trim();
  const page = String(formData.get("page") ?? "").trim();
  if (!message) redirect(threadId ? `/assistant/${threadId}` : "/assistant");

  const { active } = await getActiveChannel();
  const out = await runTurn({
    workspaceId: workspace.id,
    userId: user.id,
    role: membership.role,
    threadId: threadId || null,
    message,
    page: page.startsWith("/") ? page.slice(0, 200) : null,
    channelId: active?.id ?? null,
  });
  if (!out) redirect("/assistant");

  revalidatePath("/assistant", "layout");
  redirect(`/assistant/${out!.threadId}`);
}

export async function newAssistantThreadAction() {
  await requireRole("EDITOR");
  redirect("/assistant");
}
