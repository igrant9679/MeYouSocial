"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { setWorkspaceSetting } from "@/lib/settings";
import { QUEUE_PAUSE_SETTING, socialQueuePause, missedWhilePaused } from "@/lib/social/queue-pause";
import { claimNextFreeSlot, queueFailureMessage } from "@/lib/social/slots";

// Pause the social queue only (E-SOC-06) — Settings → Automation. Admins.

const back = (q: string): never => redirect(`/setup/automation?${q}#social-queue`);
const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;

export async function pauseSocialQueueAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  if (await socialQueuePause(workspace.id)) back("ok=" + encodeURIComponent("The social queue is already paused."));
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);
  await setWorkspaceSetting(workspace.id, QUEUE_PAUSE_SETTING, JSON.stringify({ since: new Date().toISOString(), by: user.name ?? user.email, note }));
  const scheduled = await db.socialPost.count({ where: { workspaceId: workspace.id, status: "scheduled" } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.queue_paused", entityType: "workspace", entityId: workspace.id, meta: { note, scheduled } });
  revalidatePath("/", "layout");
  back("ok=" + encodeURIComponent(`Social queue paused — ${n(scheduled, "scheduled post")} wait${scheduled === 1 ? "s" : ""} and keep${scheduled === 1 ? "s" : ""} ${scheduled === 1 ? "its" : "their"} time. Articles and everything else carry on.`));
}

/**
 * Resume. Posts whose time came while paused would otherwise all go out at
 * once: "reslot" (the default) moves each into the next free slot, in order;
 * "send" leaves them for the next sweep.
 */
export async function resumeSocialQueueAction(formData: FormData) {
  const { user, workspace } = await requireRole("ADMIN");
  const pause = await socialQueuePause(workspace.id);
  if (!pause) back("ok=" + encodeURIComponent("The social queue is already running."));
  const how = formData.get("missed") === "send" ? "send" : "reslot";
  const missed = await missedWhilePaused(workspace.id);
  let moved = 0;
  let drafted = 0;
  let failure: string | null = null;
  if (how === "reslot") {
    for (const p of missed) {
      const claim = failure ? null : await claimNextFreeSlot(workspace.id, p.id, p.category);
      if (claim && "error" in claim) failure = queueFailureMessage(claim.error);
      if (claim && !("error" in claim)) {
        moved += (await db.socialPost.updateMany({ where: { id: p.id, workspaceId: workspace.id, status: "scheduled" }, data: { scheduledAt: claim.at, timeChosen: false } })).count;
      } else {
        // No free slot: back to Drafts with its time, rather than out at once.
        drafted += (await db.socialPost.updateMany({ where: { id: p.id, workspaceId: workspace.id, status: "scheduled" }, data: { status: "draft" } })).count;
      }
    }
  }
  // Cleared only after the missed posts have moved, so none slips out meanwhile.
  await setWorkspaceSetting(workspace.id, QUEUE_PAUSE_SETTING, "");
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "social.queue_resumed", entityType: "workspace", entityId: workspace.id,
    meta: { since: pause!.since, missed: missed.length, how, reslotted: moved, drafted },
  });
  revalidatePath("/", "layout");
  const msg = missed.length === 0
    ? "Social queue resumed — nothing came due while it was paused."
    : how === "send"
      ? `Social queue resumed — ${n(missed.length, "post")} that came due while paused go${missed.length === 1 ? "es" : ""} out on the next sweep.`
      : `Social queue resumed — ${moved} of ${n(missed.length, "missed post")} moved into the next free slots.${drafted ? ` ${drafted} went back to Drafts with their times (${failure ?? "no free slot"}) — Queue all on Drafts puts them back.` : ""}`;
  back((failure ? "err=" : "ok=") + encodeURIComponent(msg));
}
