"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { snapshotBlogVersion } from "@/lib/blog-versions";
import { returnToReviewAfterEdit } from "@/lib/blog-gates";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpSetPostStatus } from "@/lib/wordpress";
import { articlesLinkingTo, repointBody } from "@/lib/blog-retire";

/**
 * Retiring or merging a live article (E-IDE-04): the steps the app can take
 * from the checklist on /blog/<id>/retire. Each re-checks the workspace and
 * the article; none touches another site without an admin pressing it.
 */

function back(postId: string, to: string, msg: string, ok: boolean): never {
  redirect(`/blog/${encodeURIComponent(postId)}/retire?to=${encodeURIComponent(to)}&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}`);
}

/** A target address: http(s), not the article's own. Pure. */
function validTarget(to: string, own: string | null): boolean {
  try {
    const u = new URL(to);
    return /^https?:$/.test(u.protocol) && to.replace(/\/+$/, "") !== (own ?? "").replace(/\/+$/, "");
  } catch {
    return false;
  }
}

/**
 * Point the workspace's own articles at the new address. EDITOR. Each changed
 * article is snapshotted first ("before repointing links"); one awaiting final
 * approval goes back to review (its approved text changed); a live one keeps
 * its status and is listed for Update on WordPress — the site still has the
 * old link until that's pushed.
 */
export async function repointLinksAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const { workspace, user } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, title: true, publishedUrl: true } });
  if (!post?.publishedUrl) back(postId, to, "Only an article with a live address can be retired or merged.", false);
  if (!validTarget(to, post.publishedUrl)) back(postId, to, "Choose where the old address should point — a full web address, not the article's own.", false);
  const linking = await articlesLinkingTo(workspace.id, post.publishedUrl, post.id);
  let articles = 0;
  let links = 0;
  for (const a of linking) {
    const row = await db.blogPost.findFirst({ where: { id: a.id, workspaceId: workspace.id }, select: { body: true, status: true } });
    if (!row?.body) continue;
    const r = repointBody(row.body, post.publishedUrl, to);
    if (!r.changed) continue;
    await snapshotBlogVersion(a.id, `before repointing links to “${post.title}”`, row.body, user.id);
    await db.blogPost.update({ where: { id: a.id }, data: { body: r.html } });
    if (row.status === "final_approval") await returnToReviewAfterEdit(workspace.id, a.id, "links repointed", user.id);
    articles++;
    links += r.changed;
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.links_repointed", entityType: "blog_post", entityId: post.id, meta: { to, articles, links } });
  revalidatePath(`/blog/${post.id}/retire`);
  back(post.id, to, articles ? `Repointed ${links} link${links === 1 ? "" : "s"} in ${articles} article${articles === 1 ? "" : "s"}. Live ones still need Update on WordPress — they're listed below.` : "No article here links to it any more.", true);
}

/** Move the old post to draft on WordPress, so it stops being served. ADMIN. */
export async function draftOldPostAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const { workspace, user } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, wpPostId: true } });
  if (post?.wpPostId == null) back(postId, to, "This article isn't a post on the connected WordPress site.", false);
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  if (!conn) back(postId, to, "No WordPress site is connected.", false);
  // ⚠ The redirect stays OUTSIDE the try: redirect() throws, and a catch here
  // swallowed it and showed "NEXT_REDIRECT" as the error (caught by the check).
  let status: string;
  try {
    const creds = { baseUrl: conn.baseUrl, username: conn.username, appPassword: decryptSecret(JSON.parse(conn.encAppPassword) as Encrypted) };
    status = (await wpSetPostStatus(creds, post.wpPostId, "draft")).status;
  } catch (e) {
    back(post.id, to, e instanceof Error ? e.message.slice(0, 200) : "WordPress didn't take the change.", false);
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.retired_on_wordpress", entityType: "blog_post", entityId: post.id, meta: { status } });
  revalidatePath(`/blog/${post.id}/retire`);
  back(post.id, to, status === "draft" ? "The old post is a draft on WordPress now — it's no longer served." : `WordPress answered "${status}" — check the post there.`, status === "draft");
}

/** Record here that the article is retired, and where it now points. EDITOR. */
export async function markRetiredAction(formData: FormData) {
  const postId = String(formData.get("postId") ?? "");
  const to = String(formData.get("to") ?? "").trim();
  const { workspace, user } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id }, select: { id: true, publishedUrl: true, retiredAt: true } });
  if (!post?.publishedUrl) back(postId, to, "Only an article with a live address can be retired.", false);
  if (!validTarget(to, post.publishedUrl)) back(postId, to, "Choose where the old address should point first.", false);
  await db.blogPost.update({ where: { id: post.id }, data: { retiredAt: new Date(), redirectTo: to } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.retired", entityType: "blog_post", entityId: post.id, meta: { to, from: post.publishedUrl } });
  revalidatePath(`/blog/${post.id}`);
  back(post.id, to, "Marked retired here — it now points at the new address. Its refresh ideas stop.", true);
}
