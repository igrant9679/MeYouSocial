"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { getSearchProvider } from "@/lib/search";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { trackLabel, trackWordTarget } from "@/lib/blog-templates";
import { applySlugConvention, parseSlugRules } from "@/lib/seo-plugins";
import { getBrandKit } from "@/lib/motifs";

/**
 * FR-7 publish preparation: the canonical slug rule, an external-source
 * suggestion, and the notes the publisher actually needs.
 *
 * The notes are assembled from stored facts — tier, keyword record, link
 * suggestions, asset state, length against the track target — rather than
 * written by a model. Nothing in them can be invented, which is the point.
 */

export async function applySlugConventionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const [post, conn] = await Promise.all([
    db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } }),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);
  if (!post) return;
  const rules = parseSlugRules(conn?.slugRules);
  const slug = applySlugConvention(post.slug || post.metaTitle || post.title, rules);
  if (!slug) return;
  await db.blogPost.update({ where: { id: post.id }, data: { slug } });
  revalidatePath(`/blog/${id}`);
}

/**
 * FR-7: one credible external link. Suggestions are stored, never auto-inserted
 * — a link is an editorial endorsement, so a human places it.
 */
export async function suggestExternalLinkAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  const { provider, real, vendor } = await getSearchProvider();
  const query = [post.focusKeyword || post.title, "research OR standard OR guidance"].join(" ");
  let results: Array<{ title: string; url: string; snippet: string }> = [];
  try {
    results = await provider.search(query, 6);
  } catch {
    results = [];
  }
  // Never suggest linking to the workspace's own site — that's an internal link.
  const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
  const ownHost = (() => {
    try {
      return conn ? new URL(conn.baseUrl).host.replace(/^www\./, "") : null;
    } catch {
      return null;
    }
  })();
  const filtered = results
    .filter((r) => /^https?:\/\//.test(r.url))
    .filter((r) => {
      try {
        return !ownHost || new URL(r.url).host.replace(/^www\./, "") !== ownHost;
      } catch {
        return false;
      }
    })
    .slice(0, 4);

  await db.setting.upsert({
    where: { key: `blog:external:${post.id}` },
    update: { value: JSON.stringify({ real, vendor, results: filtered }) },
    create: { key: `blog:external:${post.id}`, value: JSON.stringify({ real, vendor, results: filtered }) },
  });
  await writeAudit({
    workspaceId: workspace.id,
    action: "blog.external_links_suggested",
    entityType: "blog_post",
    entityId: post.id,
    meta: { vendor, real, count: filtered.length },
  });
  revalidatePath(`/blog/${id}`);
}

/** Assemble the publisher notes from what we actually know about this post. */
export async function generatePublisherNotesAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    include: { images: true },
  });
  if (!post) return;

  const [keywordRow, linksSetting, brand, conn] = await Promise.all([
    post.focusKeyword
      ? db.keyword.findFirst({
          where: { workspaceId: workspace.id, phrase: { equals: post.focusKeyword, mode: "insensitive" } },
        })
      : Promise.resolve(null),
    db.setting.findUnique({ where: { key: `blog:links:${post.id}` } }),
    getBrandKit(workspace.id),
    db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } }),
  ]);

  let links: Array<{ url: string; anchorText: string }> = [];
  try {
    links = linksSetting ? (JSON.parse(linksSetting.value) as Array<{ url: string; anchorText: string }>) : [];
  } catch {
    links = [];
  }

  const words = post.body ? post.body.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length : 0;
  const target = post.wordCountTarget ?? trackWordTarget(post.contentTier);
  const track = trackLabel(post.contentTier);
  const featured = post.images.find((i) => i.role === "featured");
  const og = post.images.find((i) => i.role === "og");

  const lines = [
    `Focus keyword: ${post.focusKeyword ? `"${post.focusKeyword}"` : "not set"}${
      keywordRow
        ? ` — tier ${keywordRow.tier}${keywordRow.intent ? `, ${keywordRow.intent} intent` : ""}${
            keywordRow.cluster ? `, cluster "${keywordRow.cluster}"` : ""
          } in the keyword strategy.`
        : post.focusKeyword
          ? " — not in the keyword strategy table; add it there if this topic is a repeat target."
          : ""
    }`,
    `Content tier: ${post.contentTier ? `${post.contentTier}${track ? ` (${track})` : ""}` : "unset"} — target ${target} words, draft is ${words}.`,
    track === "cornerstone"
      ? "Cornerstone guidance: this piece should be the hub of its cluster — link supporting posts up to it, and keep it updated rather than replacing it."
      : track === "service-supporting"
        ? "Supporting guidance: link this up to its cornerstone piece and out to the relevant service page."
        : "No track set — set a content tier so length and linking guidance apply.",
    links.length
      ? `Internal link targets: ${links.map((l) => `${l.anchorText} → ${l.url}`).join(" · ")}`
      : "Internal link targets: none suggested yet — run the internal-link suggestion.",
    `Slug: ${post.slug ?? "not set"}${conn ? "" : " (no WordPress connection yet)"}`,
    `Canonical: ${post.canonicalUrl ?? "none set — WordPress will self-canonicalise"}`,
    `Images: featured ${featured ? `${featured.width ?? "?"}×${featured.height ?? "?"}` : "missing"} (spec ${brand.featuredImageWidth}×${brand.featuredImageHeight}) · OG ${
      og ? `${og.width ?? "?"}×${og.height ?? "?"}` : "missing"
    } (spec ${brand.ogImageWidth}×${brand.ogImageHeight})`,
  ];

  await db.blogPost.update({
    where: { id: post.id },
    data: { publisherNotes: lines.join("\n") },
  });
  revalidatePath(`/blog/${id}`);
}
