"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { cleanTitle } from "@/lib/list-marker";
import { ownTopicId } from "@/lib/topics";
import { writeAudit } from "@/lib/governance";

// Social ideas on the one Ideas board ("Topics as the spine", 2026-09-21).
// Same verbs as an article idea — add, approve, reject, restore — and the
// same rule: approval is a person's act here; the engine's own gate for the
// ideas it discovers is `ideas:social_gate` (lib/social/gate.ts), never this.

function revalidate() {
  revalidatePath("/ideas", "layout");
  revalidatePath("/inbox");
}

export async function addSocialIdeaAction(formData: FormData) {
  const hook = cleanTitle(String(formData.get("title") ?? formData.get("hook") ?? ""), 240);
  if (!hook) return;
  const { user, workspace } = await requireRole("EDITOR");
  const topicId = await ownTopicId(workspace.id, formData.get("topicId"));
  const angle = String(formData.get("angle") ?? "").trim().slice(0, 300) || null;
  await db.socialIdea.create({
    data: { workspaceId: workspace.id, hook, angle, topicId, source: "manual", createdById: user.id },
  });
  revalidate();
}

export async function setSocialIdeaStatusAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["discovered", "approved", "rejected"].includes(status)) return;
  const { user, workspace } = await requireRole("EDITOR");
  // A drafted idea already has its post; its state is the post's now.
  const r = await db.socialIdea.updateMany({
    where: { id, workspaceId: workspace.id, status: { not: "drafted" } },
    data: { status, ...(status === "approved" ? { approvedAt: new Date() } : {}) },
  });
  if (r.count) {
    await writeAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: status === "approved" ? "social.idea_approved" : status === "rejected" ? "social.idea_rejected" : "social.idea_restored",
      entityType: "social_idea",
      entityId: id,
    });
  }
  revalidate();
}

export async function updateSocialIdeaAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireRole("EDITOR");
  const hook = cleanTitle(String(formData.get("hook") ?? ""), 240);
  if (!hook) return;
  const angle = String(formData.get("angle") ?? "").trim().slice(0, 300) || null;
  await db.socialIdea.updateMany({ where: { id, workspaceId: workspace.id, status: { not: "drafted" } }, data: { hook, angle } });
  revalidate();
}

/**
 * Draft now (IDE-05): write the post for this idea immediately, with the same
 * writer the sweep uses, and open it. Approved social ideas used to have no
 * button at all and could wait for good.
 */
export async function draftSocialIdeaNowAction(formData: FormData) {
  const { user, workspace, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const { draftSocialIdeaNow } = await import("@/lib/social/drafting");
  const r = await draftSocialIdeaNow(workspace.id, id, { id: user.id, role: membership.role });
  revalidate();
  revalidatePath("/social", "layout");
  const { redirect } = await import("next/navigation");
  redirect(r.ok ? `/social/${r.postId}/edit` : `/ideas?err=${encodeURIComponent(r.message)}`);
}
