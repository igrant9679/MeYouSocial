"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { setWorkspaceSetting } from "@/lib/settings";
import {
  claimNextFreeSlot,
  formatInZone,
  getPostingTimeZone,
  getQueue,
  isValidTimeZone,
  parseMinute,
  queueFailureMessage,
} from "@/lib/social/slots";

/**
 * Posting schedule + queue actions.
 *
 * Editing the SCHEDULE is admin-level: it's workspace configuration that changes
 * when everyone else's posts go out, so it sits with the other workspace config
 * (UTM tagging). USING the queue is editor-level, like every other way of
 * scheduling a post.
 */

function backTo(msg: string, kind: "err" | "ok" = "err"): never {
  redirect(`/social?${kind === "err" ? "err" : "ok"}=${encodeURIComponent(msg)}`);
}

// ---- Schedule editing ----------------------------------------------------------

/**
 * Add one time across one or more weekdays — "09:00 on Mon–Fri" in a single
 * submit, which is how people actually think about a posting schedule.
 */
export async function addPostingSlotsAction(formData: FormData) {
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
  revalidatePath("/social");
  if (count === 0) backTo("Those slots already exist.", "ok");
  backTo(`Added ${count} slot${count === 1 ? "" : "s"}.`, "ok");
}

export async function deletePostingSlotAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  // Scoped delete — a slot id from another workspace matches nothing.
  await db.postingSlot.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/social");
  backTo("Slot removed.", "ok");
}

/**
 * Pause a slot without losing it. Paused slots stop being offered to the queue;
 * posts ALREADY scheduled into one are left alone — they were scheduled, and
 * silently unscheduling someone's post would be a lie about what's going out.
 */
export async function togglePostingSlotAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const slot = await db.postingSlot.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!slot) backTo("Slot not found.");
  await db.postingSlot.update({ where: { id: slot!.id }, data: { enabled: !slot!.enabled } });
  revalidatePath("/social");
  backTo(slot!.enabled ? "Slot paused." : "Slot resumed.", "ok");
}

/** Remove every slot on one weekday — the column header's clear button. */
export async function clearWeekdaySlotsAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const weekday = Number(formData.get("weekday"));
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) backTo("Unknown day.");
  const { count } = await db.postingSlot.deleteMany({ where: { workspaceId: workspace.id, weekday } });
  revalidatePath("/social");
  backTo(count ? `Cleared ${count} slot${count === 1 ? "" : "s"}.` : "Nothing to clear.", "ok");
}

/**
 * The posting timezone. Everything about the schedule is meaningless without
 * it: the server runs in UTC, so "09:00" has to be anchored somewhere.
 */
export async function savePostingTimeZoneAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const tz = String(formData.get("timezone") ?? "").trim();
  if (!isValidTimeZone(tz)) backTo("That isn't a recognised timezone.");
  await setWorkspaceSetting(workspace.id, "social:timezone", tz);
  revalidatePath("/social");
  backTo(`Posting times are now read in ${tz}.`, "ok");
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
  const { workspace } = await requireRole("EDITOR");
  const { syncWorkspaceSocialPerformance } = await import("@/lib/social/performance");
  const out = await syncWorkspaceSocialPerformance(workspace.id);
  revalidatePath("/social");
  revalidatePath("/insights");
  backTo(out.message, out.rowsWritten > 0 || out.skipped || out.targetsPolled === 0 ? "ok" : "err");
}

// ---- Using the queue -----------------------------------------------------------

/** Drop one post into the next free slot (of its category, if it has one). */
export async function queueSocialPostAction(formData: FormData) {
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

  const claim = await claimNextFreeSlot(workspace.id, post!.id, post!.category);
  if ("error" in claim) backTo(queueFailureMessage(claim.error));

  await db.socialPost.update({
    where: { id: post!.id },
    data: { scheduledAt: claim.at, status: "scheduled" },
  });
  revalidatePath("/social");
  backTo(`Queued for ${formatInZone(claim.at, await getPostingTimeZone(workspace.id))}.`, "ok");
}

/**
 * Fill every unscheduled draft into successive free slots, oldest draft first.
 *
 * Partial success is the honest outcome when there are more drafts than slots:
 * queue what fits and say exactly how many didn't, rather than refusing the lot.
 */
export async function queueAllDraftsAction() {
  const { workspace, membership } = await requireRole("EDITOR");
  const all = await db.socialPost.findMany({
    where: { workspaceId: workspace.id, status: "draft" },
    orderBy: { createdAt: "asc" },
    select: { id: true, approval: true, category: true },
  });
  if (all.length === 0) backTo("No drafts to queue.");

  // Held posts are skipped, not failed on — "queue everything that's allowed
  // to go" is what the button means once an approval workflow exists.
  let requireApproval = false;
  if (membership.role !== "ADMIN") {
    const { getSetting } = await import("@/lib/settings");
    requireApproval = (await getSetting("social:require_approval", workspace.id).catch(() => "")) === "true";
  }
  const drafts = all.filter(
    (d) => d.approval !== "pending" && d.approval !== "changes" &&
      !(requireApproval && d.approval === null),
  );
  const held = all.length - drafts.length;
  if (drafts.length === 0) backTo(`All ${held} draft${held === 1 ? " is" : "s are"} waiting on approval.`);

  // One queue read, then assign in order — re-reading per draft would be N
  // round-trips to learn something we already know. Each draft takes the
  // earliest free slot its category allows, and slots claimed earlier in the
  // loop are gone for the drafts after it.
  const { slots, free } = await getQueue(workspace.id, { limit: 200 });
  if (slots.filter((s) => s.enabled).length === 0) backTo(queueFailureMessage("no-slots"));
  if (free.length === 0) backTo(queueFailureMessage("full"));

  const { pickFreeSlot } = await import("@/lib/social/slots");
  let remaining = free;
  const pairs: Array<{ id: string; at: Date }> = [];
  for (const d of drafts) {
    const slot = pickFreeSlot(remaining, d.category);
    if (!slot) continue; // nothing this category can take — try the next draft
    pairs.push({ id: d.id, at: slot.at });
    remaining = remaining.filter((f) => f.at.getTime() !== slot.at.getTime());
  }
  if (pairs.length === 0) backTo(queueFailureMessage("full"));

  await db.$transaction(
    pairs.map((p) =>
      db.socialPost.update({ where: { id: p.id }, data: { scheduledAt: p.at, status: "scheduled" } }),
    ),
  );
  const left = drafts.length - pairs.length;
  revalidatePath("/social");
  const bits = [`Queued ${pairs.length} draft${pairs.length === 1 ? "" : "s"}.`];
  if (left > 0) bits.push(`${left} didn't fit — add more slots.`);
  if (held > 0) bits.push(`${held} skipped (awaiting approval).`);
  backTo(bits.join(" "), "ok");
}
