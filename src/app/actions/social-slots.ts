"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { setWorkspaceSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import {
  claimNextFreeSlot,
  WEEKDAY_LABELS,
  formatInZone,
  formatMinute,
  getPostingTimeZone,
  getQueue,
  isValidTimeZone,
  parseMinute,
  queueFailureMessage,
  releasePostsFromSlots,
} from "@/lib/social/slots";

/**
 * Posting schedule + queue actions.
 *
 * Editing the SCHEDULE is admin-level: it's workspace configuration that changes
 * when everyone else's posts go out, so it sits with the other workspace config
 * (UTM tagging). USING the queue is editor-level, like every other way of
 * scheduling a post.
 */

/**
 * Flash a message and land on a Social tab.
 *
 * Since /social became a set of tabs, "back" is no longer one place: editing
 * the posting schedule should return to Settings, not bounce you to Overview
 * mid-task. Actions that belong to a tab shadow `backTo` with a one-line local
 * bound to it — that keeps every call site inside the action untouched.
 */
function flashTo(to: string, msg: string, kind: "err" | "ok"): never {
  redirect(`${to}?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

/**
 * ⚠ The `Flash` annotation is load-bearing: TypeScript only applies
 * never-returns control-flow narrowing through a VARIABLE when that variable
 * carries an explicit type annotation. Without it every `if (!post) backTo(…)`
 * below stops narrowing and the next line errors on a possibly-null value.
 */
type Flash = (msg: string, kind?: "err" | "ok") => never;

const tabFlash = (to: string): Flash => (msg, kind = "err") => flashTo(to, msg, kind);

function backTo(msg: string, kind: "err" | "ok" = "err"): never {
  return flashTo("/social", msg, kind);
}

// ---- Schedule editing ----------------------------------------------------------

/**
 * Add one time across one or more weekdays — "09:00 on Mon–Fri" in a single
 * submit, which is how people actually think about a posting schedule.
 */
export async function addPostingSlotsAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const minute = parseMinute(String(formData.get("time") ?? ""));
  if (minute === null) backTo("Enter a time as HH:MM.");
  const weekdays = [...new Set(
    formData.getAll("weekdays").map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  )];
  if (weekdays.length === 0) backTo("Pick at least one day for that slot.");
  // Optional Buffer-style category ("tips", "promo"). Empty = a general slot.
  const category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;

  // skipDuplicates: re-adding a time that already exists on some of the chosen
  // days should add the missing ones, not fail the whole submit.
  const { count } = await db.postingSlot.createMany({
    data: weekdays.map((weekday) => ({ workspaceId: workspace.id, weekday, minute: minute!, category })),
    skipDuplicates: true,
  });
  revalidatePath("/social", "layout");
  if (count === 0) backTo("Those slots already exist.", "ok");
  backTo(`Added ${count} slot${count === 1 ? "" : "s"}.`, "ok");
}

export async function deletePostingSlotAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  // Read it before deleting: releasing its posts needs the weekday and minute.
  const slot = await db.postingSlot.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!slot) backTo("Slot not found.");
  // Scoped delete — a slot id from another workspace matches nothing.
  await db.postingSlot.deleteMany({ where: { id, workspaceId: workspace.id } });

  const { released, toApproval } = await releasePostsFromSlots(
    workspace.id,
    [{ weekday: slot!.weekday, minute: slot!.minute }],
    `The ${formatMinute(slot!.minute)} slot on ${WEEKDAY_LABELS[slot!.weekday]} was removed, so this post needs a new time.`,
  );
  if (released) {
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "social.slot_removed",
      entityType: "posting_slot", entityId: id,
      meta: { weekday: slot!.weekday, minute: slot!.minute, postsReleased: released },
    });
  }
  revalidatePath("/social", "layout");
  backTo(
    released
      ? `Slot removed. ${released} post${released === 1 ? "" : "s"} the queue had put there went back to ${toApproval ? "Approvals" : "drafts"} for a new time; posts scheduled by hand keep theirs.`
      : "Slot removed.",
    "ok",
  );
}

/**
 * Pause a slot without losing it. Paused slots stop being offered to the queue;
 * posts ALREADY scheduled into one are left alone — they were scheduled, and
 * silently unscheduling someone's post would be a lie about what's going out.
 */
export async function togglePostingSlotAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const slot = await db.postingSlot.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!slot) backTo("Slot not found.");
  await db.postingSlot.update({ where: { id: slot!.id }, data: { enabled: !slot!.enabled } });
  revalidatePath("/social", "layout");
  backTo(slot!.enabled ? "Slot paused." : "Slot resumed.", "ok");
}

/** Remove every slot on one weekday — the column header's clear button. */
export async function clearWeekdaySlotsAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace, user } = await requireRole("ADMIN");
  const weekday = Number(formData.get("weekday"));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) backTo("Unknown day.");
  const slots = await db.postingSlot.findMany({ where: { workspaceId: workspace.id, weekday } });
  const { count } = await db.postingSlot.deleteMany({ where: { workspaceId: workspace.id, weekday } });

  const { released, toApproval } = await releasePostsFromSlots(
    workspace.id,
    slots.map((s) => ({ weekday: s.weekday, minute: s.minute })),
    `Every slot on ${WEEKDAY_LABELS[weekday]} was cleared, so this post needs a new time.`,
  );
  if (released) {
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, action: "social.slots_cleared",
      entityType: "posting_slot", meta: { weekday, slotsRemoved: count, postsReleased: released },
    });
  }
  revalidatePath("/social", "layout");
  if (!count) backTo("Nothing to clear.", "ok");
  backTo(
    released
      ? `Cleared ${count} slot${count === 1 ? "" : "s"}. ${released} post${released === 1 ? "" : "s"} the queue had put there went back to ${toApproval ? "Approvals" : "drafts"} for a new time; posts scheduled by hand keep theirs.`
      : `Cleared ${count} slot${count === 1 ? "" : "s"}.`,
    "ok",
  );
}

/**
 * The posting timezone. Everything about the schedule is meaningless without
 * it: the server runs in UTC, so "09:00" has to be anchored somewhere.
 */
export async function savePostingTimeZoneAction(formData: FormData) {
  const backTo: Flash = tabFlash("/setup/schedule");
  const { workspace } = await requireRole("ADMIN");
  const tz = String(formData.get("timezone") ?? "").trim();
  if (!isValidTimeZone(tz)) backTo("That isn't a recognised timezone.");
  const { resolveTimeZone, reanchorQueuedPosts } = await import("@/lib/social/slots");
  const before = await resolveTimeZone(workspace.id);
  await setWorkspaceSetting(workspace.id, "social:timezone", tz);
  // Slots are wall clock, so a new zone moves every slot. Posts the queue
  // placed used to stay at their old instants — off-slot, and double-booked
  // against the slot's new time (SOC-17). Hand-scheduled posts keep theirs.
  const moved = before.configured && before.timeZone !== tz && String(formData.get("reanchor") ?? "") === "on"
    ? await reanchorQueuedPosts(workspace.id, before.timeZone, tz)
    : null;
  revalidatePath("/social", "layout");
  backTo(
    `Posting times are now read in ${tz}.` +
      (moved ? ` ${moved.moved} queued post${moved.moved === 1 ? "" : "s"} moved to the same local time${moved.released ? `; ${moved.released} whose new time had already passed went back to drafts` : ""}.` : ""),
    "ok",
  );
}

// ---- Performance ---------------------------------------------------------------

/**
 * Pull engagement for this workspace now, rather than waiting for the sweep.
 *
 * Reports the outcome verbatim — including "polled N but read nothing usable",
 * which is the message that matters most on a first run, because it's how a
 * field-name mismatch in the stats mapper becomes visible instead of silent.
 */
export async function syncSocialPerformanceAction() {
  const backTo: Flash = tabFlash("/social/performance");
  const { workspace } = await requireRole("EDITOR");
  const { syncWorkspaceSocialPerformance } = await import("@/lib/social/performance");
  const out = await syncWorkspaceSocialPerformance(workspace.id);
  revalidatePath("/social", "layout");
  revalidatePath("/insights");
  backTo(out.message, out.rowsWritten > 0 || out.skipped || out.targetsPolled === 0 ? "ok" : "err");
}

// ---- Using the queue -----------------------------------------------------------

/** Drop one post into the next free slot (of its category, if it has one). */
export async function queueSocialPostAction(formData: FormData) {
  const backTo: Flash = tabFlash("/social/calendar");
  const { workspace, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, status: true, approval: true, category: true },
  });
  if (!post) backTo("Post not found.");
  if (post!.status !== "draft" && post!.status !== "scheduled") backTo("Only unsent posts can be queued.");
  // Queueing IS scheduling — an unapproved post must not be able to reach a
  // slot the sweep would then fire.
  if (post!.approval === "pending") backTo("That post is awaiting approval — it can't be queued yet.");
  if (post!.approval === "changes") backTo("Changes were requested on that post — edit and resubmit it first.");
  if (post!.approval === null && membership.role !== "ADMIN") {
    const { getSetting } = await import("@/lib/settings");
    if ((await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true") {
      backTo("This workspace requires approval before posts go out — submit it for approval first.");
    }
  }

  // A post its networks would certainly reject doesn't take a slot (SOC-14).
  const { scheduleRefusal } = await import("@/lib/social/validate");
  const refusal = await scheduleRefusal(post!.id);
  if (refusal) backTo(refusal);

  const claim = await claimNextFreeSlot(workspace.id, post!.id, post!.category);
  if ("error" in claim) backTo(queueFailureMessage(claim.error));

  await db.socialPost.update({
    where: { id: post!.id },
    data: { scheduledAt: claim.at, status: "scheduled", timeChosen: false },
  });
  revalidatePath("/social", "layout");
  backTo(`Queued for ${formatInZone(claim.at, await getPostingTimeZone(workspace.id))}.`, "ok");
}

/**
 * Fill every unscheduled draft into successive free slots, oldest draft first.
 *
 * Partial success is the honest outcome when there are more drafts than slots:
 * queue what fits and say exactly how many didn't, rather than refusing the lot.
 *
 * ⚠ A draft that already has a time (a holiday caption, a countdown stage, an
 * approved post keeping its requested time) is not slot material: it's
 * scheduled AT that time, or skipped when the time has passed. Re-slotting it
 * sent a Christmas caption out next Tuesday (audit SOC-06).
 */
export async function queueAllDraftsAction() {
  const backTo: Flash = tabFlash("/social/calendar");
  const { workspace, membership } = await requireRole("EDITOR");
  const all = await db.socialPost.findMany({
    where: { workspaceId: workspace.id, status: "draft" },
    orderBy: { createdAt: "asc" },
    select: { id: true, approval: true, category: true, scheduledAt: true, _count: { select: { targets: true } } },
  });
  if (all.length === 0) backTo("No drafts to queue.");

  // Held posts are skipped, not failed on — "queue everything that's allowed
  // to go" is what the button means once an approval workflow exists.
  let requireApproval = false;
  if (membership.role !== "ADMIN") {
    const { getSetting } = await import("@/lib/settings");
    requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  }
  const allowed = all.filter(
    (d) => d.approval !== "pending" && d.approval !== "changes" &&
      !(requireApproval && d.approval === null),
  );
  const held = all.length - allowed.length;
  if (allowed.length === 0) backTo(`All ${held} draft${held === 1 ? " is" : "s are"} waiting on approval.`);
  const withTargets = allowed.filter((d) => d._count.targets > 0);
  const noTargets = allowed.length - withTargets.length;
  // A draft its networks would certainly reject stays a draft, named (SOC-14).
  const { scheduleRefusal } = await import("@/lib/social/validate");
  const sendable: typeof withTargets = [];
  const ruledOut: string[] = [];
  for (const d of withTargets) {
    const refusal = await scheduleRefusal(d.id);
    if (refusal) ruledOut.push(refusal);
    else sendable.push(d);
  }
  const now = Date.now();
  const ownTime = sendable.filter((d) => d.scheduledAt && d.scheduledAt.getTime() > now + 60_000);
  const passed = sendable.filter((d) => d.scheduledAt && d.scheduledAt.getTime() <= now + 60_000).length;
  const drafts = sendable.filter((d) => !d.scheduledAt);

  // One queue read, then assign in order — re-reading per draft would be N
  // round-trips to learn something we already know. Each draft takes the
  // earliest free slot its category allows, and slots claimed earlier in the
  // loop are gone for the drafts after it.
  const pairs: Array<{ id: string; at: Date; slotted?: boolean }> = ownTime.map((d) => ({ id: d.id, at: d.scheduledAt! }));
  if (drafts.length) {
    const { slots, free } = await getQueue(workspace.id, { limit: 2000 });
    if (slots.filter((s) => s.enabled).length === 0 && pairs.length === 0) backTo(queueFailureMessage("no-slots"));
    const { claimFree } = await import("@/lib/social/slots");
    let remaining = free;
    for (const d of drafts) {
      // Reserved as it's handed out — the autopilot may be queueing too (SOC-16).
      const slot = await claimFree(workspace.id, remaining, d.category);
      if (!slot) continue; // nothing this category can take — try the next draft
      pairs.push({ id: d.id, at: slot.at, slotted: true });
      remaining = remaining.filter((f) => f.at.getTime() !== slot.at.getTime());
    }
  }
  if (pairs.length === 0) {
    backTo(
      drafts.length ? queueFailureMessage("full")
        : passed ? `Nothing queued — ${passed} draft${passed === 1 ? "'s" : "s'"} date has passed; give ${passed === 1 ? "it" : "them"} a new time.`
          : "Nothing queued — none of these drafts has an account to post to.",
    );
  }

  // Only drafts that are STILL drafts move: a send, an edit or a person's
  // own schedule since the read above wins.
  await db.$transaction(
    pairs.map((p) =>
      db.socialPost.updateMany({ where: { id: p.id, workspaceId: workspace.id, status: "draft" }, data: { scheduledAt: p.at, status: "scheduled", ...(p.slotted ? { timeChosen: false } : {}) } }),
    ),
  );
  const slotted = pairs.length - ownTime.length;
  const left = drafts.length - slotted;
  revalidatePath("/social", "layout");
  const bits = [`Queued ${slotted} draft${slotted === 1 ? "" : "s"}.`];
  if (ownTime.length) bits.push(`${ownTime.length} scheduled at ${ownTime.length === 1 ? "its own" : "their own"} time.`);
  if (left > 0) bits.push(`${left} didn't fit — add more slots.`);
  if (passed > 0) bits.push(`${passed} skipped — ${passed === 1 ? "its" : "their"} date has passed.`);
  if (noTargets > 0) bits.push(`${noTargets} skipped — no account to post to.`);
  if (ruledOut.length > 0) bits.push(`${ruledOut.length} skipped — a network would reject ${ruledOut.length === 1 ? "it" : "them"} (${ruledOut[0]}${ruledOut.length > 1 ? " …" : ""}).`);
  if (held > 0) bits.push(`${held} skipped (awaiting approval).`);
  backTo(bits.join(" "), "ok");
}
