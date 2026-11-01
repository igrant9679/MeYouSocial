import { db } from "@/lib/db";
import type { CheckResult } from "@/lib/blog-checks";

/**
 * Advisory overlap checks (E-ART-13) — another article in this workspace aiming
 * at the same focus keyword (two pages competing for one search: merge, or
 * give one a different angle) or using the same slug (the second publish would
 * get "-2" on WordPress, or collide on an exported site). Never blocking: the
 * person decides; the panel names the other article.
 */
type Post = { id: string; workspaceId: string; focusKeyword: string | null; slug: string | null };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const STATUS_LABEL: Record<string, string> = { published: "published", final_approval: "at final approval", draft_review: "in review", drafting: "drafting" };

export async function overlapChecks(post: Post): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const kw = post.focusKeyword ? norm(post.focusKeyword) : "";
  const slug = post.slug ? post.slug.trim().toLowerCase() : "";
  const others = kw || slug
    ? await db.blogPost.findMany({
        where: {
          workspaceId: post.workspaceId,
          id: { not: post.id },
          status: { not: "archived" },
          OR: [
            ...(kw ? [{ focusKeyword: { equals: post.focusKeyword!.trim(), mode: "insensitive" as const } }] : []),
            ...(slug ? [{ slug: { equals: slug, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { id: true, title: true, status: true, focusKeyword: true, slug: true },
        take: 10,
      })
    : [];
  const name = (o: (typeof others)[number]) => `“${o.title.slice(0, 70)}” (${STATUS_LABEL[o.status] ?? o.status})`;
  if (kw) {
    const same = others.filter((o) => o.focusKeyword && norm(o.focusKeyword) === kw);
    out.push({
      id: "keyword-overlap",
      label: "No other article targets this focus keyword",
      pass: same.length === 0,
      required: false,
      detail: same.length ? `Also targeted by ${same.slice(0, 3).map(name).join(", ")}${same.length > 3 ? ` and ${same.length - 3} more` : ""} — merge them, or give this one a different keyword` : undefined,
    });
  }
  if (slug) {
    const same = others.filter((o) => o.slug && o.slug.toLowerCase() === slug);
    out.push({
      id: "slug-duplicate",
      label: "Slug is unique in this workspace",
      pass: same.length === 0,
      required: false,
      detail: same.length ? `${name(same[0])} uses /${slug} too — change one before both go live` : undefined,
    });
  }
  return out;
}
