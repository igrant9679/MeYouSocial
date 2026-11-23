"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { isHomePage, parseLiveLink, sameLivePage } from "@/lib/live-link";

/**
 * The manual half of the no-WordPress fallback: after an article's HTML was
 * downloaded and added to a site by hand, record it as published (with the
 * live URL) so the loop moves on — social variants, analytics and the board
 * all key off `published`. ADMIN only, like every other publish.
 */
export async function markPublishedManuallyAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const rawUrl = String(formData.get("url") ?? "").trim();
  const { workspace, user } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true, refreshStartedAt: true, publishedAt: true, publishedUrl: true } });
  if (!post) return;
  // From the editor or from Publish — each flashes back where it was used.
  const fromEditor = String(formData.get("back") ?? "") === "editor";
  const fail = (msg: string) => redirect(fromEditor ? `/blog/${post.id}?flashErr=${encodeURIComponent(msg)}` : `/publish?err=${encodeURIComponent(msg)}`);
  if (post.status !== "final_approval") {
    fail(`"${post.title.slice(0, 60)}" is at ${post.status}, not final approval — only articles that passed every check can be marked published.`);
  }
  // ⚠ The live link is required (ART-12): "published" with no URL sent social
  // posts out with no link and gave analytics nothing to match.
  let publishedUrl: string | null = null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "http:" || u.protocol === "https:") publishedUrl = u.toString();
  } catch { /* not a URL */ }
  if (!publishedUrl) fail("Paste the article's live link (the full https:// address) — social posts and analytics key off it.");
  // A refresh (lib/idea-drafting.ts) replaced the page it was already live on:
  // it keeps the date it first went live, and is no longer being revised.
  const refresh = post.refreshStartedAt != null;
  await db.blogPost.update({
    where: { id: post.id },
    data: { status: "published", publishedAt: refresh ? post.publishedAt ?? new Date() : new Date(), publishedUrl, refreshStartedAt: null },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: refresh ? "blog.refreshed_manually" : "blog.published_manually",
    entityType: "blog_post",
    entityId: post.id,
    meta: { publishedUrl, via: "html export", ...(refresh ? { previousUrl: post.publishedUrl } : {}) },
  });
  revalidatePath("/publish");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/inbox");
  const done = `"${post.title.slice(0, 60)}" recorded as ${refresh ? "refreshed" : "published"} at ${publishedUrl}.`;
  redirect(fromEditor ? `/blog/${post.id}?flash=${encodeURIComponent(done)}` : `/publish?ok=${encodeURIComponent(done)}`);
}

/**
 * "Add live link" (2026-11-23, the owner's "Yes, build it"): the web address of
 * an article that is already published but has none in Publisher — marked
 * published before the live link was required (ART-12), or by hand. Without it
 * the composer's Add link can't offer the article and analytics can't match it.
 *
 * The rules Publisher already keeps elsewhere: ADMIN only, a full address,
 * only a published article, never replacing a link that's there (also at the
 * write, so a link saved in between wins), and never an address another
 * article already has. The date it went live is left alone.
 */
export async function addLiveLinkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, title: true, status: true, publishedUrl: true } });
  if (!post) return;
  const fromEditor = String(formData.get("back") ?? "") === "editor";
  const name = `"${post.title.slice(0, 60)}"`;
  const go = (msg: string, ok: boolean) =>
    // The box is on the article's Distribute tab, so the answer opens there.
    redirect(fromEditor ? `/blog/${post.id}?tab=distribute&${ok ? "flash" : "flashErr"}=${encodeURIComponent(msg)}` : `/publish?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);
  if (post.status !== "published") return go(`${name} isn't published, so it has no live page yet — it gets its link when it's published.`, false);
  if (post.publishedUrl) return go(`${name} already has a live link (${post.publishedUrl}); it wasn't changed.`, false);
  const url = parseLiveLink(String(formData.get("url") ?? ""));
  if (!url) return go("Paste the article's full live address, starting https:// — the page on your site where it's published.", false);
  if (isHomePage(url)) return go(`${url} is your site's home page. Paste the address of the article's own page.`, false);
  const others = await db.blogPost.findMany({ where: { workspaceId: workspace.id, id: { not: post.id }, publishedUrl: { not: null } }, select: { title: true, publishedUrl: true } });
  const taken = others.find((o) => sameLivePage(o.publishedUrl!, url));
  if (taken) return go(`That address is already "${taken.title.slice(0, 60)}" (${taken.publishedUrl}), so it wasn't saved — two articles on one page would share its numbers.`, false);
  const saved = await db.blogPost.updateMany({ where: { id: post.id, publishedUrl: null, status: "published" }, data: { publishedUrl: url } });
  if (saved.count === 0) return go(`${name} changed while you were adding the link, so nothing was saved — reload and look again.`, false);
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "blog.live_link_added", entityType: "blog_post", entityId: post.id, meta: { publishedUrl: url } });
  // Search Console may have listed the page as unmatched; it isn't now.
  const { forgetUnmatched, urlKey } = await import("@/lib/analytics/sync");
  await forgetUnmatched(workspace.id, urlKey(url)).catch(() => undefined);
  revalidatePath("/publish");
  revalidatePath("/blog");
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/social/compose");
  revalidatePath("/admin/analytics");
  go(`Saved ${url} as the live link of ${name}. Add link in the composer offers it now, and analytics matches it from the next sync.`, true);
}
