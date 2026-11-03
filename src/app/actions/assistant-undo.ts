"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership } from "@/lib/acl";
import { undoStep } from "@/lib/assistant/undo";

/**
 * Undo one assistant step (E-ENG-09). Every check — the reply is this
 * person's, in this workspace, inside the ten minutes, not already undone,
 * their role still allows the tool, and the thing is exactly as the
 * assistant left it — is made in lib/assistant/undo.ts `undoStep`.
 */
export async function undoAssistantStepAction(messageId: string, index: number): Promise<{ ok: boolean; message: string }> {
  const { user, workspace, membership } = await requireMembership();
  const r = await undoStep({ workspaceId: workspace.id, userId: user.id, role: membership.role, messageId: String(messageId).slice(0, 40), index: Number(index) | 0 });
  if (r.threadId) revalidatePath(`/assistant/${r.threadId}`);
  return { ok: r.ok, message: r.message };
}

/** The conversation page's form: the same undo, landing back on the thread with the outcome. */
export async function undoAssistantStepFormAction(formData: FormData) {
  const { user, workspace, membership } = await requireMembership();
  const r = await undoStep({ workspaceId: workspace.id, userId: user.id, role: membership.role, messageId: String(formData.get("messageId") ?? "").slice(0, 40), index: Number(formData.get("index") ?? -1) | 0 });
  if (!r.threadId) redirect(`/assistant?err=${encodeURIComponent(r.message)}`);
  revalidatePath(`/assistant/${r.threadId}`);
  redirect(`/assistant/${r.threadId}?${r.ok ? "ok" : "err"}=${encodeURIComponent(r.message)}`);
}
