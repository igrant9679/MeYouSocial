import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { brandGuardrailBlock, motifPromptFor } from "@/lib/motifs";

/**
 * SEO metadata generation — ONE implementation for the manual button and the
 * autopilot's drafting step.
 *
 * The publish gate (blog-checks.ts) REQUIRES meta title, meta description and
 * a well-formed slug, and wants the focus keyword in the title or meta title.
 * Until 2026-08-12 only a manual button could produce these, so every
 * autopilot draft parked at review with its SEO checks failing — the same
 * stall the images had. This core is what the autopilot now runs after each
 * draft, gated by `blog:auto_seo` (absent = ON, "false" = off — the
 * auto_image convention; the toggle lives on Blog → Automation).
 */

export type SeoMetaResult =
  | { ok: true; wrote: string[] }
  | { ok: false; reason: "paused" | "not-found" | "mock" | "unparseable" | "nothing-to-write" };

export async function generateSeoMetaCore(
  workspaceId: string,
  postId: string,
  opts?: {
    /**
     * Unattended callers set this: only EMPTY fields are written, so a human's
     * hand-tuned meta title (or a slug that's already been published under)
     * survives a re-run. The manual button omits it — a person clicking
     * "Generate" is asking for regeneration.
     */
    onlyFillEmpty?: boolean;
  },
): Promise<SeoMetaResult> {
  if (await isGloballyPaused(workspaceId)) return { ok: false, reason: "paused" };
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId } });
  if (!post) return { ok: false, reason: "not-found" };
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return { ok: false, reason: "not-found" };

  const [motifs, guardrails] = await Promise.all([
    motifPromptFor(workspaceId, post, "short"),
    brandGuardrailBlock(workspaceId),
  ]);

  const res = await llm.complete({
    model: post.model ?? workspace.defaultModel ?? llm.defaultModel,
    system:
      'Generate SEO metadata. Respond ONLY with JSON: {"metaTitle": string (≤60 chars), "metaDescription": string (≤155 chars, compelling, ends with a benefit), "slug": string (lowercase-hyphenated, ≤6 words)}.',
    messages: [
      {
        role: "user",
        content: [
          `Title: "${post.title}"`,
          motifs,
          guardrails,
          post.focusKeyword ? `Focus keyword (must appear in metaTitle and slug): ${post.focusKeyword}` : null,
          post.body ? `Content: ${post.body.replace(/<[^>]+>/g, " ").slice(0, 800)}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    maxTokens: 300,
    workspaceId,
  });
  // The router's silent mock fallback writes fluent nonsense into fields the
  // publish gate then happily passes — worse than leaving them empty, because
  // empty fails loudly at review and mock text sails through to a real site.
  if (res.provider === "mock") return { ok: false, reason: "mock" };

  let meta: { metaTitle?: string; metaDescription?: string; slug?: string } = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    meta = m ? JSON.parse(m[0]) : {};
  } catch {
    meta = {};
  }
  const slug =
    typeof meta.slug === "string"
      ? meta.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
      : null;

  const fill = opts?.onlyFillEmpty === true;
  const data: { metaTitle?: string; metaDescription?: string; slug?: string } = {};
  if (typeof meta.metaTitle === "string" && meta.metaTitle.trim() && (!fill || !post.metaTitle)) {
    data.metaTitle = meta.metaTitle.slice(0, 60);
  }
  if (typeof meta.metaDescription === "string" && meta.metaDescription.trim() && (!fill || !post.metaDescription)) {
    data.metaDescription = meta.metaDescription.slice(0, 155);
  }
  if (slug && (!fill || !post.slug)) {
    data.slug = slug;
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, reason: meta.metaTitle || meta.metaDescription || slug ? "nothing-to-write" : "unparseable" };
  }

  await db.blogPost.update({ where: { id: post.id }, data });
  await writeAudit({
    workspaceId,
    action: "blog.meta_generated",
    entityType: "blog_post",
    entityId: post.id,
    meta: { wrote: Object.keys(data), onlyFillEmpty: fill },
  });
  return { ok: true, wrote: Object.keys(data) };
}
