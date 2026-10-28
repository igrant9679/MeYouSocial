"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { claimNextFreeSlot, getPostingTimeZone, queueFailureMessage, zonedParts, zonedTimeToUtc } from "@/lib/social/slots";
import { formatDay } from "@/lib/zoned-dates";
import { writeAudit } from "@/lib/governance";
import { DELETABLE_POST_STATUSES } from "@/lib/social/post-lists";

// Bulk actions on the Queue / Sent / Drafts lists (Socialmonials parity,
// 2026-10-17). One action, an `op`, a set of ids — every write re-filters by
// the caller's workspace AND by the status the op is allowed to touch, so a
// stale checkbox can never delete history or unschedule something already
// sent.

const LIST_PATH = /^\/social\/(queue|sent|drafts)(\?[\w=&%.+-]*)?$/;

function back(formData: FormData, msg: string, kind: "ok" | "err"): never {
  const raw = String(formData.get("back") ?? "/social/queue");
  const target = LIST_PATH.test(raw) ? raw : "/social/queue";
  const [path, query] = target.split("?");
  // Drop any old flash from the kept query string.
  const kept = (query ?? "").split("&").filter((p) => p && !/^(ok|err)=/.test(p)).join("&");
  redirect(`${path}?${kept ? `${kept}&` : ""}${kind}=${encodeURIComponent(msg)}`);
}

export async function bulkPostsAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const op = String(formData.get("op") ?? "");
  const ids = [...new Set(formData.getAll("ids").map(String).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) back(formData, "Tick at least one post first.", "err");
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;

  if (op === "delete") {
    // Never history: posted and partly-posted rows are the record of what went
    // out. Failed ones never reached anyone, so they may go.
    const r = await db.socialPost.deleteMany({
      where: { id: { in: ids }, workspaceId: workspace.id, status: { in: DELETABLE_POST_STATUSES } },
    });
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.bulk_deleted", entityType: "social_post", meta: { asked: ids.length, deleted: r.count } });
    revalidatePath("/social", "layout");
    back(formData, `Deleted ${n(r.count, "post")}${r.count < ids.length ? ` — ${ids.length - r.count} skipped (already sent, or publishing)` : ""}.`, "ok");
  }

  if (op === "unschedule") {
    const r = await db.socialPost.updateMany({
      where: { id: { in: ids }, workspaceId: workspace.id, status: "scheduled" },
      data: { status: "draft", scheduledAt: null },
    });
    revalidatePath("/social", "layout");
    back(formData, `Moved ${n(r.count, "post")} back to drafts${r.count < ids.length ? ` — ${ids.length - r.count} weren't scheduled` : ""}.`, "ok");
  }

  if (op === "queue") {
    // Same rules as queueing one draft: held posts never take a slot, and with
    // the approval workflow on a non-admin's unreviewed post can't either.
    const { getSetting } = await import("@/lib/settings");
    const requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
    const drafts = await db.socialPost.findMany({
      where: { id: { in: ids }, workspaceId: workspace.id, status: "draft" },
      orderBy: { createdAt: "asc" },
      select: { id: true, approval: true, category: true, scheduledAt: true, _count: { select: { targets: true } } },
    });
    let queued = 0;
    let held = 0;
    let noTargets = 0;
    let passed = 0;
    let failure: string | null = null;
    // A draft its networks would certainly reject stays a draft (SOC-14).
    const { scheduleRefusal } = await import("@/lib/social/validate");
    const ruledOut: string[] = [];
    for (const d of drafts) {
      if (d.approval === "pending" || d.approval === "changes" || (requireApproval && d.approval === null && membership.role !== "ADMIN")) { held++; continue; }
      if (d._count.targets === 0) { noTargets++; continue; }
      const refusal = await scheduleRefusal(d.id);
      if (refusal) { ruledOut.push(refusal); continue; }
      // A draft with its own time keeps it (a holiday, a countdown stage) —
      // never re-slotted (audit SOC-06); a time that has passed is skipped.
      if (d.scheduledAt) {
        if (d.scheduledAt.getTime() <= Date.now() + 60_000) { passed++; continue; }
        await db.socialPost.updateMany({ where: { id: d.id, status: "draft" }, data: { status: "scheduled" } });
        queued++;
        continue;
      }
      const claim = await claimNextFreeSlot(workspace.id, d.id, d.category);
      if ("error" in claim) { failure = queueFailureMessage(claim.error); break; }
      await db.socialPost.update({ where: { id: d.id }, data: { status: "scheduled", scheduledAt: claim.at, timeChosen: false } });
      queued++;
    }
    revalidatePath("/social", "layout");
    const notes = [
      held ? `${n(held, "post")} held for approval` : "",
      noTargets ? `${n(noTargets, "post")} with no account to post to` : "",
      passed ? `${n(passed, "post")} whose date has passed` : "",
      ruledOut.length ? `${n(ruledOut.length, "post")} a network would reject (${ruledOut[0]}${ruledOut.length > 1 ? " …" : ""})` : "",
      failure ? `stopped: ${failure}` : "",
    ].filter(Boolean);
    back(formData, `Queued ${n(queued, "post")}${notes.length ? ` — ${notes.join("; ")}` : ""}.`, queued ? "ok" : "err");
  }

  // ── Queue management (E-SOC-05) ──────────────────────────────────────────────
  // Only SCHEDULED posts move (never one already sending), only to a moment
  // still ahead, and each move is conditional on the post still being
  // scheduled — a post the sweep claimed mid-press is left alone.
  if (op === "shift" || op === "moveto" || op === "reslot" || op === "shuffle") {
    const rows = await db.socialPost.findMany({
      where: { id: { in: ids }, workspaceId: workspace.id, status: "scheduled", scheduledAt: { not: null } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, scheduledAt: true, category: true, timeChosen: true },
    });
    const notQueued = ids.length - rows.length;
    const ahead = (d: Date) => d.getTime() > Date.now() + 60_000;
    const tz = await getPostingTimeZone(workspace.id);
    const also = (k: number, one: string, many: string) => (k ? ` ${k} ${k === 1 ? one : many}.` : "");
    const audit = (moved: number, meta: Record<string, unknown> = {}) =>
      writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.queue_rearranged", entityType: "social_post", meta: { op, asked: ids.length, moved, ...meta } });
    // A move a person asked for is their chosen time (SOC-17): removing a slot won't move it again.
    const move = async (id: string, at: Date, timeChosen = true) =>
      (await db.socialPost.updateMany({ where: { id, workspaceId: workspace.id, status: "scheduled" }, data: { scheduledAt: at, timeChosen } })).count;

    if (op === "shift" || op === "moveto") {
      let target: { y: number; m: number; d: number } | null = null;
      let days = 0;
      if (op === "shift") {
        days = Number.parseInt(String(formData.get("days") ?? ""), 10);
        if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 90) back(formData, "Shift by a whole number of days between -90 and 90 (not 0).", "err");
      } else {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(formData.get("date") ?? "").trim());
        const [y, mo, d] = m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
        if (!m || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) back(formData, "Pick the day to move them to.", "err");
        target = { y, m: mo, d };
      }
      let moved = 0;
      let past = 0;
      for (const r of rows) {
        // Wall clock in the posting zone, so 09:00 stays 09:00 across a clock change.
        const z = zonedParts(r.scheduledAt!, tz);
        const [hh, mm] = [Math.floor(z.minute / 60), z.minute % 60];
        const at = target
          ? zonedTimeToUtc(target.y, target.m, target.d, hh, mm, tz)
          : zonedTimeToUtc(z.year, z.month, z.day + days, hh, mm, tz);
        if (!ahead(at)) { past++; continue; }
        moved += await move(r.id, at);
      }
      await audit(moved, target ? { to: `${target.y}-${target.m}-${target.d}` } : { days });
      revalidatePath("/social", "layout");
      const what = target
        ? `to ${formatDay(zonedTimeToUtc(target.y, target.m, target.d, 12, 0, tz), tz)}, each at its own time of day`
        : `${days > 0 ? "later" : "earlier"} by ${n(Math.abs(days), "day")}, each at its own time of day`;
      back(formData, `Moved ${n(moved, "post")} ${what}.${also(past, "would have landed in the past and stayed put", "would have landed in the past and stayed put")}${also(notQueued, "wasn't scheduled", "weren't scheduled")}`, moved ? "ok" : "err");
    }

    if (op === "reslot") {
      // The earliest free slots, in the order the posts were in. A post's own
      // time counts as free while it's being placed (claimNextFreeSlot leaves it
      // out), so posts already on the earliest slots stay where they are.
      let moved = 0;
      let kept = 0;
      let failure: string | null = null;
      for (const r of rows) {
        const claim = await claimNextFreeSlot(workspace.id, r.id, r.category);
        if ("error" in claim) { failure = queueFailureMessage(claim.error); break; }
        if (claim.at.getTime() === r.scheduledAt!.getTime()) { kept++; continue; }
        moved += await move(r.id, claim.at, false);
      }
      await audit(moved, { kept });
      revalidatePath("/social", "layout");
      back(formData, `Re-slotted ${n(moved + kept, "post")}: ${moved} moved into the earliest free slots, ${kept} already there.${also(notQueued, "wasn't scheduled", "weren't scheduled")}${failure ? ` Stopped: ${failure}` : ""}`, moved + kept ? "ok" : "err");
    }

    if (op === "shuffle") {
      if (rows.length < 2) back(formData, "Tick at least two scheduled posts to shuffle.", "err");
      // The same times in a different order: each time keeps whether a person chose it.
      const times = rows.map((r) => ({ at: r.scheduledAt!, chosen: r.timeChosen }));
      const order = [...rows];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      // A shuffle that changed nothing isn't one — rotate instead.
      if (order.every((r, i) => r.id === rows[i].id)) order.push(order.shift()!);
      let moved = 0;
      for (const [i, r] of order.entries()) {
        if (r.scheduledAt!.getTime() === times[i].at.getTime()) continue;
        moved += await move(r.id, times[i].at, times[i].chosen);
      }
      await audit(moved);
      revalidatePath("/social", "layout");
      back(formData, `Shuffled ${n(rows.length, "post")} among the same times.${also(notQueued, "wasn't scheduled", "weren't scheduled")}`, "ok");
    }
  }

  back(formData, "Unknown action.", "err");
}

/**
 * Swap two queued posts' times (E-SOC-05) — the Queue's earlier / later
 * buttons. Both must still be scheduled at the times the page showed; the swap
 * is one transaction, so it happens whole or not at all.
 */
export async function swapQueuedPostsAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const a = String(formData.get("a") ?? "");
  const b = String(formData.get("b") ?? "");
  if (!a || !b || a === b) back(formData, "Nothing to swap.", "err");
  const rows = await db.socialPost.findMany({
    where: { id: { in: [a, b] }, workspaceId: workspace.id, status: "scheduled", scheduledAt: { gt: new Date(Date.now() + 60_000) } },
    select: { id: true, scheduledAt: true, timeChosen: true },
  });
  if (rows.length !== 2) back(formData, "One of them has gone out or moved since — nothing was swapped.", "err");
  const [x, y] = rows;
  let swapped = true;
  try {
    await db.$transaction(async (tx) => {
      const r1 = await tx.socialPost.updateMany({ where: { id: x.id, status: "scheduled", scheduledAt: x.scheduledAt }, data: { scheduledAt: y.scheduledAt, timeChosen: y.timeChosen } });
      const r2 = await tx.socialPost.updateMany({ where: { id: y.id, status: "scheduled", scheduledAt: y.scheduledAt }, data: { scheduledAt: x.scheduledAt, timeChosen: x.timeChosen } });
      if (r1.count !== 1 || r2.count !== 1) throw new Error("moved");
    });
  } catch {
    swapped = false;
  }
  if (!swapped) back(formData, "One of them has gone out or moved since — nothing was swapped.", "err");
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.queue_rearranged", entityType: "social_post", meta: { op: "swap", posts: [x.id, y.id] } });
  revalidatePath("/social", "layout");
  back(formData, "Swapped their times.", "ok");
}
