"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { syncShotList } from "@/lib/shot-list";

/** E-VID-09: put a script's marked shots in Assets (linked to its project). EDITOR. */
export async function syncShotListAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId") ?? "");
  const { workspace, user } = await requireRole("EDITOR");
  const out = await syncShotList(workspace.id, scriptId);
  const back = (msg: string, ok: boolean) => `/scripts/${encodeURIComponent(scriptId)}?tab=shots&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`;
  if (!out) redirect(back("That script isn't in this workspace.", false));
  if (out.shots === 0) redirect(back("No shots are marked in the script yet — write [B-roll: …] where one belongs.", false));
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "script.shot_list_synced", entityType: "script", entityId: scriptId, meta: { ...out } });
  revalidatePath(`/scripts/${scriptId}`);
  revalidatePath("/production/film-queue");
  revalidatePath("/production/assets");
  const parts = [
    out.added ? `${out.added} added to Assets` : "nothing new",
    out.kept ? `${out.kept} already there` : null,
    out.gone ? `${out.gone} no longer in the script (kept — it may be filmed)` : null,
  ].filter(Boolean);
  redirect(back(`Shot list: ${parts.join(", ")}.${out.project ? "" : " Track the script in production to see them in the Film Queue."}`, true));
}
