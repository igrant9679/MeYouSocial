"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { setWorkspaceSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { LIB_ENABLED, LIB_SLUG, SLUG_RE } from "@/lib/link-in-bio";

/**
 * Turn the link-in-bio page on or off and choose its address (E-SOC-11). ADMIN:
 * it publishes a public page. The address is unique across workspaces —
 * refused, not silently suffixed, when another workspace has it.
 */
export async function saveLinkInBioAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const back = (k: "ok" | "err", m: string): never => redirect(`/setup/schedule?${k}=${encodeURIComponent(m)}#link-in-bio`);
  const enabled = formData.get("enabled") === "on";
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if ((enabled || slug) && !SLUG_RE.test(slug)) back("err", "The address is 3–40 letters, numbers or hyphens, not starting or ending with a hyphen.");
  if (slug) {
    const taken = await db.workspaceSetting.findFirst({ where: { key: LIB_SLUG, value: slug, workspaceId: { not: workspace.id } }, select: { workspaceId: true } });
    if (taken) back("err", `/l/${slug} is already another workspace's page — pick another address.`);
  }
  await setWorkspaceSetting(workspace.id, LIB_SLUG, slug);
  await setWorkspaceSetting(workspace.id, LIB_ENABLED, enabled ? "true" : "false");
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.link_in_bio_saved", entityType: "workspace", entityId: workspace.id, meta: { enabled, slug } });
  revalidatePath("/setup/schedule");
  back("ok", enabled ? `Your link-in-bio page is live at /l/${slug}.` : "The link-in-bio page is off.");
}
