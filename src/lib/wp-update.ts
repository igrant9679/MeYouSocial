/**
 * "Update on WordPress" (E-ART-02): push edits of a live article — body,
 * title, description, images — to the same WordPress post, after seeing what
 * would change against what the site actually says now.
 *
 * The comparison reads the live post back (edit context) and diffs it, block
 * by block and word by word (lib/text-diff), against what publishing would
 * send now (the same render). Images compare by their alt text, so a URL the
 * site rewrote isn't a change; our structured-data script is left out of both.
 * The push itself is publishCore's update mode — the same send as a refresh,
 * same gates (an article with a [NEEDS SOURCE] marker or failing checks is
 * held), same read-back — without taking the article back through review.
 */

import { db } from "@/lib/db";
import { getBrandKit } from "@/lib/motifs";
import { renderForPublish, stripLeadingH1 } from "@/lib/blog-render";
import { isRenderProfile, parseRenderRules } from "@/lib/design-render";
import { decryptSecret, type Encrypted } from "@/lib/blog-crypto";
import { wpReadPostContent, type WpCredentials } from "@/lib/wordpress";
import { diffBlocks, diffStats, htmlBlocks, type Row } from "@/lib/text-diff";

export type LiveComparison =
  | { ok: false; error: string }
  | {
      ok: true;
      link: string;
      liveModified: string | null;
      rows: Row[];
      stats: { added: number; removed: number; blocks: number };
      title: { live: string; now: string; changed: boolean };
      excerpt: { live: string; now: string; changed: boolean };
      /** Images replaced since the last publish — they're uploaded again on update. */
      imagesChanged: string[];
      unchanged: boolean;
    };

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&quot;|&#8220;|&#8221;/g, '"').replace(/\s+/g, " ").trim();

/** The live body without what publishing adds around the article (our JSON-LD). Pure. */
export function liveBodyForDiff(content: string): string {
  return content.replace(/<script\b[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

export async function compareWithLive(workspaceId: string, postId: string): Promise<LiveComparison> {
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId }, include: { images: true } });
  if (!post?.body) return { ok: false, error: "That article has no body." };
  if (post.wpPostId == null || post.status !== "published") return { ok: false, error: "Only an article that's live on WordPress can be updated there." };
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId } });
  if (!conn) return { ok: false, error: "No WordPress site is connected." };
  let creds: WpCredentials;
  try {
    creds = { baseUrl: conn.baseUrl, username: conn.username, appPassword: decryptSecret(JSON.parse(conn.encAppPassword) as Encrypted) };
  } catch {
    return { ok: false, error: "The WordPress connection's password can't be read — reconnect the site." };
  }
  const live = await wpReadPostContent(creds, post.wpPostId);
  if (!live) return { ok: false, error: "The post couldn't be read from WordPress — check the connection, or whether it was deleted there." };

  const brand = await getBrandKit(workspaceId);
  const now = renderForPublish(stripLeadingH1(post.body), {
    headingSpec: brand.headingSpec,
    footerCredit: brand.footerCredit,
    renderProfile: isRenderProfile(brand.renderProfile) ? brand.renderProfile : "html",
    renderRules: parseRenderRules(brand.renderRules),
  }).html;
  const rows = diffBlocks(htmlBlocks(liveBodyForDiff(live.content)), htmlBlocks(now));
  const stats = diffStats(rows);
  const titleNow = post.title;
  const excerptNow = post.metaDescription ?? "";
  const title = { live: plain(live.title), now: titleNow, changed: plain(live.title) !== plain(titleNow) };
  const excerpt = { live: plain(live.excerpt), now: excerptNow, changed: plain(live.excerpt) !== plain(excerptNow) };
  const since = post.publishedAt ?? new Date(0);
  const imagesChanged = post.images.filter((i) => i.status === "approved" && i.updatedAt > since).map((i) => (i.role === "og" ? "Open Graph image" : "Featured image"));
  return {
    ok: true,
    link: live.link || post.publishedUrl || "",
    liveModified: live.modified,
    rows,
    stats,
    title,
    excerpt,
    imagesChanged,
    unchanged: stats.added === 0 && stats.removed === 0 && !title.changed && !excerpt.changed && imagesChanged.length === 0,
  };
}
