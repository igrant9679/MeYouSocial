"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { advanceIfReadyCore } from "@/lib/blog-gates";
import { bulkIds } from "@/lib/article-list";
import { formatInZone, getPostingTimeZone, parseZonedInput } from "@/lib/social/slots";

/**
 * Bulk actions on the Articles list (E-ART-08). Each one does what the
 * article's own page would do, article by article, with the same role and the
 * same checks — the list only saves the clicking. Ids come from the form and
 * are always narrowed to this workspace before anything is touched.
 */

const s = (n: number) => (n === 1 ? "" : "s");

/** Back to the list the person was on — only ever a list URL. */
function backTo(formData: FormData, key: "ok" | "err", text: string): never {
  const raw = String(formData.get("back") ?? "");
  const base = raw.startsWith("/blog?view=list") ? raw.replace(/&?(ok|err)=[^&]*/g, "") : "/blog?view=list";
  redirect(`${base}&${key}=${encodeURIComponent(text)}`);
}

export async function bulkArticlesAction(formData: FormData) {
  const op = String(formData.get("op") ?? "");
  const ids = bulkIds(formData);
  if (!ids.length) backTo(formData, "err", "Tick at least one article first.");

  if (op === "assign") {
    const { user, workspace } = await requireRole("EDITOR");
    const reviewerId = String(formData.get("reviewerId") ?? "").trim() || null;
    if (reviewerId && !(await db.membership.findFirst({ where: { workspaceId: workspace.id, userId: reviewerId, status: "active" } }))) {
      backTo(formData, "err", "That person isn't an active member of this workspace.");
    }
    const posts = await db.blogPost.findMany({ where: { id: { in: ids }, workspaceId: workspace.id }, select: { id: true, title: true } });
    await db.blogPost.updateMany({ where: { id: { in: posts.map((p) => p.id) } }, data: { reviewerId } });
    for (const p of posts) {
      await writeAudit({
        workspaceId: workspace.id, actorId: user.id, action: reviewerId ? "blog.reviewer_assigned" : "blog.reviewer_cleared",
        entityType: "blog_post", entityId: p.id, meta: { reviewerId, bulk: true },
      });
    }
    // One notice for the lot, not one per article.
    if (reviewerId && reviewerId !== user.id && posts.length) {
      await notify({
        workspaceId: workspace.id, kind: "assigned", userIds: [reviewerId],
        title: posts.length === 1 ? `You're the reviewer for "${posts[0].title}"` : `You're the reviewer for ${posts.length} articles`,
        path: posts.length === 1 ? `/blog/${posts[0].id}` : `/blog?view=list&reviewer=${reviewerId}`,
      });
    }
    revalidatePath("/blog");
    backTo(formData, "ok", reviewerId ? `Reviewer set on ${posts.length} article${s(posts.length)}.` : `Reviewer cleared on ${posts.length} article${s(posts.length)}.`);
  }

  if (op === "advance") {
    // In review → final approval, only where the checks pass (or an admin's override covers the body).
    const { workspace } = await requireRole("EDITOR");
    const posts = await db.blogPost.findMany({ where: { id: { in: ids }, workspaceId: workspace.id }, select: { id: true, status: true } });
    let moved = 0, held = 0, elsewhere = 0;
    for (const p of posts) {
      if (p.status !== "draft_review") { elsewhere++; continue; }
      if (await advanceIfReadyCore(workspace.id, p.id, "the Articles list")) moved++; else held++;
    }
    revalidatePath("/blog");
    const parts = [`${moved} moved to final approval`];
    if (held) parts.push(`${held} still fail${held === 1 ? "s" : ""} a check — open ${held === 1 ? "it" : "them"} to see which`);
    if (elsewhere) parts.push(`${elsewhere} weren't in review`);
    backTo(formData, moved ? "ok" : "err", `${parts.join("; ")}.`);
  }

  if (op === "schedule") {
    // Setting a time is the human approval to publish — an admin's act, at final approval only.
    const { user, workspace } = await requireRole("ADMIN");
    const tz = await getPostingTimeZone(workspace.id);
    const day = String(formData.get("startDay") ?? "").trim();
    const time = String(formData.get("time") ?? "").trim() || "09:00";
    const every = Math.min(14, Math.max(1, Math.floor(Number(formData.get("everyDays") ?? 1)) || 1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) backTo(formData, "err", "Pick a first day and a time.");
    const first = parseZonedInput(`${day}T${time}`, tz);
    if (!first || first.getTime() <= Date.now()) backTo(formData, "err", "The first time has to be in the future.");
    const order = new Map(ids.map((id, i) => [id, i]));
    const posts = (await db.blogPost.findMany({ where: { id: { in: ids }, workspaceId: workspace.id, status: "final_approval" }, select: { id: true, title: true } }))
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    if (!posts.length) backTo(formData, "err", "None of those is at final approval, so there's nothing to schedule.");
    const [y, m, d] = day.split("-").map(Number);
    const when: Date[] = [];
    for (let i = 0; i < posts.length; i++) {
      // Wall-clock steps in the posting zone, so 09:00 stays 09:00 across a clock change.
      const local = new Date(Date.UTC(y, m - 1, d + i * every)).toISOString().slice(0, 10);
      const at = parseZonedInput(`${local}T${time}`, tz);
      if (!at) backTo(formData, "err", "That time couldn't be read.");
      when.push(at);
    }
    for (let i = 0; i < posts.length; i++) {
      await db.blogPost.updateMany({ where: { id: posts[i].id, workspaceId: workspace.id, status: "final_approval" }, data: { scheduledAt: when[i] } });
      await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.scheduled", entityType: "blog_post", entityId: posts[i].id, meta: { scheduledAt: when[i].toISOString(), bulk: true } });
    }
    await notify({
      workspaceId: workspace.id, kind: "scheduled", excludeUserId: user.id,
      title: posts.length === 1 ? `"${posts[0].title}" is scheduled for ${formatInZone(when[0], tz)} ${tz}` : `${posts.length} articles scheduled, the first ${formatInZone(when[0], tz)} ${tz}`,
      body: "The gates are re-checked at the moment of publish.",
      path: "/blog/calendar",
    });
    revalidatePath("/blog");
    const skipped = ids.length - posts.length;
    backTo(formData, "ok", `Scheduled ${posts.length} article${s(posts.length)} from ${formatInZone(when[0], tz)}, ${every === 1 ? "one a day" : `every ${every} days`}${skipped ? `; ${skipped} not at final approval were left alone` : ""}.`);
  }

  if (op === "delete") {
    // An admin's act, as on the article. Published articles are kept: they're live, with their numbers — delete one of those on its own page.
    const { user, workspace } = await requireRole("ADMIN");
    if (formData.get("confirm") !== "yes") backTo(formData, "err", "Deleting needs the confirmation.");
    const posts = await db.blogPost.findMany({ where: { id: { in: ids }, workspaceId: workspace.id }, select: { id: true, title: true, status: true } });
    const doomed = posts.filter((p) => p.status !== "published");
    await db.blogPost.deleteMany({ where: { id: { in: doomed.map((p) => p.id) }, workspaceId: workspace.id, status: { not: "published" } } });
    for (const p of doomed) {
      await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.deleted", entityType: "blog_post", entityId: p.id, meta: { title: p.title, bulk: true } });
    }
    revalidatePath("/blog");
    const kept = posts.length - doomed.length;
    backTo(formData, "ok", `Deleted ${doomed.length} article${s(doomed.length)}${kept ? `; ${kept} published one${s(kept)} kept — delete those from their own page` : ""}.`);
  }

  backTo(formData, "err", "Unknown action.");
}
