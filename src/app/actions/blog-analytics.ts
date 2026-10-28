"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
  // ⚠ MEA-17: a reading is ONE day's numbers (the metrics spine sums rows),
  // and it lands on the day named — undated, a typed 28-day total was added
  // on top of the synced day. A day the sync already covers is refused.
  const dayRaw = String(formData.get("day") ?? "").trim();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayRaw) ? new Date(`${dayRaw}T00:00:00.000Z`) : null;
  const back = (msg: string) => redirect(`/blog/analytics?flashErr=${encodeURIComponent(msg)}`);
  if (!day || Number.isNaN(day.getTime()) || day.getTime() > Date.now()) back("Pick the day these numbers are for — one day's figures, not a total.");
  const synced = await db.blogSnapshot.count({ where: { postId, source: { not: "manual" }, capturedAt: { gte: day!, lt: new Date(day!.getTime() + 86_400_000) } } });
  if (synced) back("Search Console or GA4 already recorded that day for this post — a typed figure would be counted twice.");
  await db.blogSnapshot.create({ data: { postId, capturedAt: day!, source: "manual", ...data } });
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
