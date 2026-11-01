"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { writeAudit } from "@/lib/governance";
import { createRefreshIdea, decayAngle, decayingPosts } from "@/lib/content-decay";

/**
 * Measure → Losing clicks → "Make a refresh idea" (E-MEA-15). Editors. The
 * evidence is measured again here, never taken from the form: an article that
 * stopped decaying since the page loaded gets no idea.
 */
export async function makeDecayRefreshIdeaAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const postId = String(formData.get("postId") ?? "");
  const back = (q: string) => redirect(`/measure?${q}#losing-clicks`);
  const d = (await decayingPosts(workspace.id)).find((x) => x.postId === postId);
  if (!d) back(`err=${encodeURIComponent("That article isn't losing clicks any more, so there's nothing to refresh it for.")}`);
  if (!d!.refreshable) {
    back(`err=${encodeURIComponent(d!.protectedFromRewrite ? "That article is protected from rewrites — lift the protection first." : "That article has no live link the app knows, so a refresh couldn't be published.")}`);
  }
  const id = await createRefreshIdea(workspace.id, d!, decayAngle(d!));
  if (!id) back(`err=${encodeURIComponent("An idea to refresh that article exists already.")}`);
  await writeAudit({
    workspaceId: workspace.id, actorId: user.id, action: "ideas.decay_refresh", entityType: "blog_idea", entityId: id!,
    meta: { postId, recentClicks: d!.recentClicks, priorClicks: d!.priorClicks },
  });
  revalidatePath("/measure");
  back(`ok=${encodeURIComponent(`“${d!.title}” has a refresh idea on the Ideas board — approve it to draft.`)}`);
}
