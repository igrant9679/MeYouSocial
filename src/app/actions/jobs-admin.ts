"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { jobLabel } from "@/lib/jobs/admin";

// Settings → Jobs (E-ENG-17). Both writes are conditional on the state the
// button was shown for, so a job the worker claimed in the meantime is left
// alone and the flash says so.

const back = (q: string): never => redirect(`/admin/jobs?${q}`);

/** A failed job goes back in the queue with fresh attempts — it runs on the next sweep. */
export async function retryJobAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const job = await db.job.findFirst({ where: { id, workspaceId: workspace.id }, select: { name: true } });
  if (!job) back("flashErr=" + encodeURIComponent("That job isn't in this workspace."));
  // Steps it already finished are kept (ENG-22): the retry carries on after them.
  const count = await db.job.updateMany({
    where: { id, workspaceId: workspace.id, state: "failed" },
    data: { state: "queued", attempts: 0, runAfter: null, claimedAt: null, claimedBy: null, finishedAt: null, progress: 0, lastLog: `Retried by ${user.name ?? user.email ?? "an admin"}` },
  }).then((r) => r.count, (e: { code?: string }) => {
    // One live job per thing (ENG-22): another copy is already waiting or running.
    if (e?.code === "P2002") back("flashErr=" + encodeURIComponent(`Another “${jobLabel(job!.name)}” for the same thing is already waiting or running — this one wasn't queued again.`));
    throw e;
  });
  if (!count) back("flashErr=" + encodeURIComponent("That job isn't failed any more — nothing was changed."));
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "job.retried", entityType: "job", entityId: id, meta: { name: job!.name } });
  revalidatePath("/admin/jobs");
  back("flash=" + encodeURIComponent(`“${jobLabel(job!.name)}” is queued again; it runs on the next sweep.`));
}

/**
 * A QUEUED job is cancelled (failed, with who did it). A running one isn't —
 * its handler owns stopping it (the script agent and renders have their own
 * Cancel), and pulling the row out from under it would only hide the work.
 */
export async function cancelJobAction(formData: FormData) {
  const { workspace, user } = await requireRole("ADMIN");
  const id = String(formData.get("id") ?? "");
  const job = await db.job.findFirst({ where: { id, workspaceId: workspace.id }, select: { name: true } });
  if (!job) back("flashErr=" + encodeURIComponent("That job isn't in this workspace."));
  const { count } = await db.job.updateMany({
    where: { id, workspaceId: workspace.id, state: "queued" },
    data: { state: "failed", error: `Cancelled by ${user.name ?? user.email ?? "an admin"}`, finishedAt: new Date(), runAfter: null },
  });
  if (!count) back("flashErr=" + encodeURIComponent("That job started (or finished) meanwhile — a running job is stopped from its own page."));
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "job.cancelled", entityType: "job", entityId: id, meta: { name: job!.name } });
  revalidatePath("/admin/jobs");
  back("flash=" + encodeURIComponent(`Cancelled “${jobLabel(job!.name)}”.`));
}
