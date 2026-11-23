"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";

/**
 * Article Social Share, by hand (2026-11-23): an article's Distribute tab has "Share it now" and "Don't share this
 * one". Editors and up, like Draft now on an idea. "Share it now" always writes a DRAFT and opens it — a person who
 * pressed it reads the post before it goes out, whatever the workspace's dial says.
 */

// Declared (not a const arrow) so TS narrows on its `never` return.
function back(id: string, msg: string, ok: boolean): never {
  redirect(`/blog/${id}?tab=distribute&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
}

export async function shareArticleNowAction(formData: FormData) {
  const { workspace, user, membership } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const { shareArticle } = await import("@/lib/social/article-share");
  const res = await shareArticle(workspace.id, id, { mode: "draft", actor: { id: user.id, role: membership.role } });
  if (!res.ok) back(id, res.message, false);
  revalidatePath(`/blog/${id}`);
  revalidatePath("/social", "layout");
  // The draft opens in the editor: read it, then send, schedule or queue it there.
  redirect(`/social/${res.socialPostId}/edit`);
}

export async function unskipArticleShareAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const { unskipArticleShare } = await import("@/lib/social/article-share");
  const res = await unskipArticleShare(workspace.id, id, user.id);
  revalidatePath(`/blog/${id}`);
  back(id, res.message, res.ok);
}

export async function skipArticleShareAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const { skipArticleShare } = await import("@/lib/social/article-share");
  const res = await skipArticleShare(workspace.id, id, user.id);
  revalidatePath(`/blog/${id}`);
  back(id, res.message, res.ok);
}
