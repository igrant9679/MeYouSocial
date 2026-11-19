"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { setWorkspaceSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { STUDIO_KEY } from "@/lib/studio";

/** The "Video studio" switch under Settings (One-Loop step 6). Admin-only. */
export async function setStudioEnabledAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const on = String(formData.get("enabled") ?? "") === "true";
  await setWorkspaceSetting(workspace.id, STUDIO_KEY, on ? "true" : "false");
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "settings.saved",
    entityType: "setting",
    entityId: STUDIO_KEY,
    meta: { key: STUDIO_KEY, value: on ? "true" : "false" },
  });
  // The strip is in the shell, so every page's tabs change with this.
  revalidatePath("/", "layout");
  redirect(`/setup?ok=${encodeURIComponent(on ? "Video studio on — Video shows on the rail, with Scripts, Thumbnails, Renders and Production." : "Video studio off — the studio tabs and controls are hidden; nothing was deleted.")}`);
}
