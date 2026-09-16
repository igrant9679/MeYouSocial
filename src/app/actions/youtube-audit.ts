"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { AUDIT_WINDOWS, youtubeAuditFor, type AuditWindow } from "@/lib/youtube/analytics";

/** The Refresh button on /youtube — a live pull for the chosen window. */
export async function refreshYoutubeAuditAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const parsed = parseInt(String(formData.get("days") ?? "90"), 10);
  const days: AuditWindow = (AUDIT_WINDOWS as readonly number[]).includes(parsed) ? (parsed as AuditWindow) : 90;
  const res = await youtubeAuditFor(workspace.id, days, { refresh: true });
  revalidatePath("/youtube");
  if (res.state === "ok") {
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "youtube.audit_refreshed", entityType: "channel", entityId: res.audit.channel.id, meta: { days, views: res.audit.totals.views, videos: res.audit.videos.length } });
    redirect(`/youtube?days=${days}&ok=${encodeURIComponent(`Pulled ${res.audit.days} days from YouTube — ${res.audit.totals.views.toLocaleString("en-US")} views across ${res.audit.videos.length} videos.`)}`);
  }
  redirect(`/youtube?days=${days}&err=${encodeURIComponent(res.state === "not_connected" ? "YouTube is not connected for this workspace." : res.message)}`);
}
