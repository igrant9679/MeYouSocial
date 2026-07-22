"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

/**
 * Manual analytics snapshots (Spark FR-14 port). Operator-entered numbers only
 * — the app never invents metrics; GSC/GA4 connectors replace this later.
 */

export async function recordSnapshotAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;

  const num = (k: string, float = false) => {
    const raw = String(formData.get(k) ?? "").trim();
    if (!raw) return null;
    const n = float ? parseFloat(raw) : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const data = {
    impressions: num("impressions"),
    clicks: num("clicks"),
    position: num("position", true),
    sessions: num("sessions"),
    conversions: num("conversions"),
  };
  if (Object.values(data).every((v) => v === null)) return; // nothing entered
  await db.blogSnapshot.create({ data: { postId, ...data } });
  revalidatePath("/blog/analytics");
}

/** FR-14 hard constraint: shield a top performer from regeneration. */
export async function toggleProtectAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;
  await db.blogPost.update({
    where: { id: post.id },
    data: { protectedFromRewrite: !post.protectedFromRewrite },
  });
  revalidatePath("/blog/analytics");
  revalidatePath(`/blog/${post.id}`);
}
