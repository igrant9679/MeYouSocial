"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

// A person's own conversations with the assistant (E-ENG-11): rename and
// delete. Only ever their own — a thread is private to whoever had it.

const back = (q: string): never => redirect(`/assistant?${q}#threads`);

export async function renameThreadAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) back("flashErr=" + encodeURIComponent("Give it a name."));
  const r = await db.assistantThread.updateMany({ where: { id, workspaceId: workspace.id, userId: user.id }, data: { title } });
  if (!r.count) back("flashErr=" + encodeURIComponent("That conversation isn't yours, or is gone."));
  revalidatePath("/assistant");
  back("flash=" + encodeURIComponent(`Renamed to “${title}”.`));
}

export async function deleteThreadAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  if (formData.get("confirm") !== "yes") back("flashErr=" + encodeURIComponent("Tick the box to delete it."));
  // Messages go with it (cascade). What it DID stays in the audit log and the run history.
  const r = await db.assistantThread.deleteMany({ where: { id, workspaceId: workspace.id, userId: user.id } });
  if (!r.count) back("flashErr=" + encodeURIComponent("That conversation isn't yours, or is gone."));
  revalidatePath("/assistant");
  back("flash=" + encodeURIComponent("Conversation deleted. What it did is still in the run history."));
}
