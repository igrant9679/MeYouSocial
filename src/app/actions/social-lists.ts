"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { claimNextFreeSlot, queueFailureMessage } from "@/lib/social/slots";
import { writeAudit } from "@/lib/governance";

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
      where: { id: { in: ids }, workspaceId: workspace.id, status: { in: ["draft", "scheduled", "failed"] } },
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
      select: { id: true, approval: true, category: true, _count: { select: { targets: true } } },
    });
    let queued = 0;
    let held = 0;
    let noTargets = 0;
    let failure: string | null = null;
    for (const d of drafts) {
      if (d.approval === "pending" || d.approval === "changes" || (requireApproval && d.approval === null && membership.role !== "ADMIN")) { held++; continue; }
      if (d._count.targets === 0) { noTargets++; continue; }
      const claim = await claimNextFreeSlot(workspace.id, d.id, d.category);
      if ("error" in claim) { failure = queueFailureMessage(claim.error); break; }
      await db.socialPost.update({ where: { id: d.id }, data: { status: "scheduled", scheduledAt: claim.at } });
      queued++;
    }
    revalidatePath("/social", "layout");
    const notes = [
      held ? `${n(held, "post")} held for approval` : "",
      noTargets ? `${n(noTargets, "post")} with no account to post to` : "",
      failure ? `stopped: ${failure}` : "",
    ].filter(Boolean);
    back(formData, `Queued ${n(queued, "post")}${notes.length ? ` — ${notes.join("; ")}` : ""}.`, queued ? "ok" : "err");
  }

  back(formData, "Unknown action.", "err");
}
