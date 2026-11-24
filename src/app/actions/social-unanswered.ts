"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { lookUpUnanswered } from "@/lib/social/unanswered";

// "Ask Zernio" on a post's page: for a send that never got an answer, read the
// outcome back from Zernio's own list of posts. It sends nothing; the rules
// (and why "not there" needs proof) are in lib/social/unanswered.ts.

function toPost(postId: string, msg: string, kind: "ok" | "err" = "err"): never {
  redirect(`/social/${postId}?${kind}=${encodeURIComponent(msg)}`);
}

export async function askZernioAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const postId = String(formData.get("id") ?? "");
  const post = await db.socialPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true } });
  if (!post) redirect("/social/sent?err=" + encodeURIComponent("That post isn't in this workspace."));

  const out = await lookUpUnanswered(post.id, user.id);
  revalidatePath(`/social/${post.id}`);
  revalidatePath("/social", "layout");
  revalidatePath("/inbox");

  if (out.verdict === "nothing") toPost(post.id, "Nothing on this post is waiting on an answer.", "ok");
  if (out.verdict === "error") toPost(post.id, `Couldn't ask Zernio: ${out.detail ?? "unknown error"} Nothing was changed.`);
  if (out.verdict === "unproven") {
    toPost(post.id, `Zernio's list couldn't settle it: ${out.detail ?? "it couldn't be checked."} Nothing was changed, so check the network before you retry.`);
  }
  if (out.verdict === "no_record") toPost(post.id, "Zernio has no post matching this one, so it did not go out. Retry is safe.", "ok");
  const parts = [
    out.posted ? `${out.posted} posted` : "",
    out.failed ? `${out.failed} failed` : "",
    out.pending ? `${out.pending} still sending` : "",
  ].filter(Boolean).join(", ");
  toPost(post.id, `Zernio's record of this send: ${parts || "no change"}. Each network's status is below.`, "ok");
}
