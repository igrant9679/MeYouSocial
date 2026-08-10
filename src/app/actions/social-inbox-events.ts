"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";

/**
 * Marking inbox events as seen.
 *
 * ⚠ Deliberately an EXPLICIT action, never a side effect of rendering. The
 * obvious design — mark a thread read when its page renders — is wrong here:
 * Next prefetches links on hover, so an unread comment could be silently
 * cleared by a mouse passing over it, and the one thing an unread badge must
 * never do is lie about what you've seen.
 */
export async function markInboxEventsReadAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const threadId = String(formData.get("threadId") ?? "").trim();
  const back = String(formData.get("back") ?? "/social/engage");

  const { count } = await db.socialInboxEvent.updateMany({
    // Tenancy in the WHERE, not just the lookup — a threadId from another
    // workspace must match nothing.
    where: { workspaceId: workspace.id, readAt: null, ...(threadId ? { threadId } : {}) },
    data: { readAt: new Date() },
  });

  revalidatePath("/social", "layout");
  const target = back.startsWith("/social") ? back : "/social/engage";
  const sep = target.includes("?") ? "&" : "?";
  redirect(`${target}${sep}ok=${encodeURIComponent(count === 1 ? "Marked 1 item as seen." : `Marked ${count} items as seen.`)}`);
}
