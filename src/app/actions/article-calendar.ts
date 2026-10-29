"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { formatInZone, getPostingTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

/** An article put on no time keeps this one: the morning of the day it's dropped on. */
const DEFAULT_MINUTE = 9 * 60;

/**
 * Move an article on the publishing calendar (E-ART-07): to a day — keeping its
 * time of day in the POSTING timezone, 09:00 when it had none — or off the
 * calendar (`day = null`). The same rule as the editor's Schedule: an admin's
 * act, at final approval only, because setting the time is the approval to
 * publish; the gates are re-checked when it falls due.
 */
export async function rescheduleArticleAction(id: string, day: string | null): Promise<{ ok: boolean; message: string; label?: string }> {
  const { user, workspace } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true, scheduledAt: true } });
  if (!post) return { ok: false, message: "That article is gone." };
  if (post.status !== "final_approval") return { ok: false, message: "Only an article at final approval can be scheduled — setting its time is the approval to publish." };
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const touch = () => { revalidatePath("/blog/calendar"); revalidatePath(`/blog/${post.id}`); revalidatePath("/publish"); };

  if (day === null) {
    if (!post.scheduledAt) return { ok: true, message: "It wasn't scheduled." };
    await db.blogPost.updateMany({ where: { id: post.id, status: "final_approval" }, data: { scheduledAt: null } });
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.unscheduled", entityType: "blog_post", entityId: post.id, meta: { via: "calendar" } });
    touch();
    return { ok: true, message: `“${post.title}” is off the calendar — it waits at final approval.` };
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const [y, mo, d] = m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  if (!m || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return { ok: false, message: "That isn't a day." };
  const minute = post.scheduledAt ? zonedParts(post.scheduledAt, tz).minute : DEFAULT_MINUTE;
  const at = zonedTimeToUtc(y, mo, d, Math.floor(minute / 60), minute % 60, tz);
  if (at.getTime() <= Date.now() + 60_000) return { ok: false, message: `${formatInZone(at, tz)} has already passed — pick a day ahead.` };

  const r = await db.blogPost.updateMany({ where: { id: post.id, status: "final_approval" }, data: { scheduledAt: at } });
  if (!r.count) return { ok: false, message: "It moved on from final approval in the meantime." };
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.scheduled", entityType: "blog_post", entityId: post.id, meta: { scheduledAt: at.toISOString(), via: "calendar" } });
  await notify({
    workspaceId: workspace.id,
    kind: "scheduled",
    title: `"${post.title}" is scheduled for ${formatInZone(at, tz)} ${tz}`,
    body: "The gates are re-checked at the moment of publish.",
    path: `/blog/${post.id}`,
    entityType: "blog_post",
    entityId: post.id,
    excludeUserId: user.id,
  });
  touch();
  return { ok: true, message: `Scheduled for ${formatInZone(at, tz)} (${tz}).`, label: formatInZone(at, tz) };
}
