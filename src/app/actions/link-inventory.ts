"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpListPosts } from "@/lib/wordpress";
import { hrefs, linkPhrase, normalizeUrl } from "@/lib/link-inventory";
import { returnToReviewAfterEdit } from "@/lib/blog-gates";
import { snapshotBlogVersion } from "@/lib/blog-versions";

const toWebsite = (kind: "ok" | "err", text: string): never => redirect(`/website?${kind}=${encodeURIComponent(text)}#internal-links`);
const toOptimize = (id: string, kind: "ok" | "err", text: string): never =>
  redirect(`/blog/${encodeURIComponent(id)}?tab=optimize&${kind === "ok" ? "flash" : "flashErr"}=${encodeURIComponent(text)}#internal-links`);

/**
 * Read the live site's posts from WordPress (read-only, the content audit's
 * call) and keep each one as a site page with the internal links it has
 * (E-ART-12). Pages already recorded by hand keep their title and topic.
 */
export async function readSiteLinksAction() {
  const { user, workspace } = await requireRole("EDITOR");
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  if (!conn) toWebsite("err", "Connect WordPress above first — the links are read from the live site.");
  let appPassword: string;
  try { appPassword = decryptSecret(JSON.parse(conn!.encAppPassword) as Encrypted); } catch { return toWebsite("err", "The stored WordPress password can't be read — save the connection again."); }
  const posts = await wpListPosts({ baseUrl: conn!.baseUrl, username: conn!.username, appPassword }, 200);
  if (!posts.length) toWebsite("err", "WordPress returned no published posts — test the connection above.");
  const site = normalizeUrl(conn!.baseUrl);
  const host = site ? new URL(site).host : null;
  const now = new Date();
  let links = 0;
  for (const p of posts) {
    const self = normalizeUrl(p.link);
    if (!self) continue;
    const to = [...new Set(hrefs(p.content).map((h) => normalizeUrl(h, p.link)).filter((t): t is string => !!t && t !== self && new URL(t).host === host))];
    links += to.length;
    await db.sitePage.upsert({
      where: { workspaceId_url: { workspaceId: workspace.id, url: p.link } },
      update: { source: "wordpress", linksTo: JSON.stringify(to), crawledAt: now },
      create: { workspaceId: workspace.id, url: p.link, title: p.title.slice(0, 300), source: "wordpress", linksTo: JSON.stringify(to), crawledAt: now },
    });
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "site.links_read", entityType: "workspace", entityId: workspace.id, meta: { posts: posts.length, links } });
  revalidatePath("/website");
  toWebsite("ok", `Read ${posts.length} post${posts.length === 1 ? "" : "s"} from WordPress — ${links} internal link${links === 1 ? "" : "s"} among them.`);
}

/**
 * Link another article to this one (E-ART-12's inbound half): wrap the first
 * free mention of this article's focus keyword in that article with a link
 * here. The other article is snapshotted first and goes back through review —
 * a published one is republished, so the live page changes only then.
 */
export async function linkFromArticleAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const targetId = String(formData.get("targetId") ?? "");
  const fromId = String(formData.get("fromId") ?? "");
  const [target, from] = await Promise.all([
    db.blogPost.findFirst({ where: { id: targetId, workspaceId: workspace.id }, select: { id: true, title: true, publishedUrl: true, focusKeyword: true } }),
    db.blogPost.findFirst({ where: { id: fromId, workspaceId: workspace.id }, select: { id: true, title: true, body: true, publishedUrl: true, protectedFromRewrite: true, status: true, wpPostId: true } }),
  ]);
  if (!target) return redirect("/blog");
  if (!from?.body) toOptimize(target.id, "err", "That article is gone or has no text.");
  if (!target.publishedUrl || !target.focusKeyword) toOptimize(target.id, "err", "This article needs a live link and a focus keyword before others can link to it.");
  if (from!.protectedFromRewrite) toOptimize(target.id, "err", `“${from!.title}” is protected from rewrites, so it was left alone.`);
  const url = normalizeUrl(target.publishedUrl!);
  if (hrefs(from!.body!).some((h) => normalizeUrl(h, from!.publishedUrl ?? undefined) === url)) toOptimize(target.id, "err", `“${from!.title}” already links here.`);
  const done = linkPhrase(from!.body!, target.focusKeyword!, target.publishedUrl!);
  if (!done) toOptimize(target.id, "err", `“${from!.title}” no longer mentions “${target.focusKeyword}” outside a link — nothing to link.`);
  await snapshotBlogVersion(from!.id, `Before linking to “${target.title.slice(0, 80)}”`, from!.body, user.id);
  await db.blogPost.update({ where: { id: from!.id }, data: { body: done!.body } });
  const after = await returnToReviewAfterEdit(workspace.id, from!.id, "internal link", user.id);
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.internal_link_added", entityType: "blog_post", entityId: from!.id, meta: { to: target.id, text: done!.text } });
  revalidatePath(`/blog/${from!.id}`);
  revalidatePath(`/blog/${target.id}`);
  revalidatePath("/website");
  toOptimize(target.id, "ok", `Linked “${done!.text}” in “${from!.title}” to this article.${after === "refresh" ? " It goes back through review and republishes, so its live page changes then." : after === "review" ? " It was at final approval, so it's back in review." : from!.status === "published" && !from!.wpPostId ? " Its live page isn't on the connected WordPress, so make the same change there." : ""}`);
}
