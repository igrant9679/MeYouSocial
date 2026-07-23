import { trackLabel, trackWordTarget } from "@/lib/blog-templates";

// Blog pre-publish checks — ported from Spark's lib/checks.ts. Deterministic,
// no LLM: SEO metadata rules, WCAG-flavored content checks on the HTML body,
// and Flesch reading ease. The publish gate (actions/blog.ts) requires all
// `required` checks to pass; advisory ones just render in the panel.

export type CheckResult = {
  id: string;
  label: string;
  pass: boolean;
  required: boolean;
  detail?: string;
};

type PostLike = {
  title: string;
  body: string | null;
  slug: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  focusKeyword: string | null;
  wordCountTarget: number | null;
  contentTier?: number | null;
};

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Flesch reading ease (0–100; higher = easier). Ported from Spark. */
export function fleschReadingEase(text: string): number | null {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (words.length < 20 || sentences.length === 0) return null;
  const syllables = words.reduce((acc, w) => {
    const groups = w.replace(/e\b/, "").match(/[aeiouy]+/g);
    return acc + Math.max(1, groups ? groups.length : 1);
  }, 0);
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * FR-8 asset gate input. Omitted (e.g. in advisory scoring) means "don't judge
 * the assets" — the publish paths always pass it.
 */
export type AssetGate = {
  /** Workspace policy: when false the image checks render advisory, not blocking. */
  required: boolean;
  images: Array<{
    role: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    status: string;
    branded: boolean;
  }>;
  spec: { featured: { width: number; height: number }; og: { width: number; height: number } };
};

function assetChecks(gate: AssetGate): CheckResult[] {
  const out: CheckResult[] = [];
  for (const role of ["featured", "og"] as const) {
    const label = role === "featured" ? "Featured image" : "Branded OG image";
    const img = gate.images.find((i) => i.role === role);
    const spec = gate.spec[role];
    if (!img) {
      out.push({
        id: `img-${role}`,
        label: `${label} attached (${spec.width}×${spec.height})`,
        pass: false,
        required: gate.required,
        detail: "missing",
      });
      continue;
    }
    // An AI-generated image is not an asset until a human says it is.
    const reviewed = img.status === "approved";
    const sized = img.width === spec.width && img.height === spec.height;
    const hasAlt = !!img.altText?.trim();
    const brandedOk = role !== "og" || img.branded;
    const problems = [
      reviewed ? null : "awaiting human review",
      sized ? null : img.width && img.height ? `${img.width}×${img.height}, needs ${spec.width}×${spec.height}` : "size unknown",
      hasAlt ? null : "no alt text",
      brandedOk ? null : "not marked as branded",
    ].filter(Boolean);
    out.push({
      id: `img-${role}`,
      label: `${label} attached (${spec.width}×${spec.height})`,
      pass: problems.length === 0,
      required: gate.required,
      detail: problems.length ? problems.join("; ") : `${img.width}×${img.height}, alt set`,
    });
  }
  return out;
}

export function runBlogChecks(post: PostLike, unverifiedCitations: number, assets?: AssetGate): CheckResult[] {
  const body = post.body ?? "";
  const text = stripTags(body);
  const words = text ? text.split(/\s+/).length : 0;
  const kw = post.focusKeyword?.toLowerCase().trim();

  const checks: CheckResult[] = [];

  // --- SEO (required) ---------------------------------------------------------
  checks.push({
    id: "meta-title",
    label: "Meta title present, ≤ 60 chars",
    pass: !!post.metaTitle && post.metaTitle.length <= 60,
    required: true,
    detail: post.metaTitle ? `${post.metaTitle.length}/60` : "missing",
  });
  checks.push({
    id: "meta-desc",
    label: "Meta description present, ≤ 155 chars",
    pass: !!post.metaDescription && post.metaDescription.length <= 155,
    required: true,
    detail: post.metaDescription ? `${post.metaDescription.length}/155` : "missing",
  });
  checks.push({
    id: "slug",
    label: "URL slug set (lowercase, hyphenated)",
    pass: !!post.slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug),
    required: true,
    detail: post.slug ?? "missing",
  });
  checks.push({
    id: "kw-title",
    label: "Focus keyword in title or meta title",
    pass: !kw || post.title.toLowerCase().includes(kw) || (post.metaTitle ?? "").toLowerCase().includes(kw),
    required: true,
    detail: kw ? undefined : "no keyword set (check passes)",
  });
  checks.push({
    id: "kw-body",
    label: "Focus keyword appears in the body",
    pass: !kw || text.toLowerCase().includes(kw),
    required: false,
  });

  // --- Content / WCAG (body-dependent) ---------------------------------------
  checks.push({
    id: "body",
    label: "Draft body exists",
    pass: words > 0,
    required: true,
  });
  const imgs = body.match(/<img\b[^>]*>/gi) ?? [];
  const imgsMissingAlt = imgs.filter((t) => !/\balt\s*=\s*"[^"]+"/i.test(t)).length;
  checks.push({
    id: "img-alt",
    label: "All images have alt text (WCAG 1.1.1)",
    pass: imgsMissingAlt === 0,
    required: true,
    detail: imgs.length ? `${imgs.length - imgsMissingAlt}/${imgs.length} have alt` : "no images",
  });
  const headings = [...body.matchAll(/<h([1-6])\b/gi)].map((m) => parseInt(m[1], 10));
  const skips = headings.some((h, i) => i > 0 && h > headings[i - 1] + 1);
  checks.push({
    id: "headings",
    label: "Heading levels don't skip (WCAG 1.3.1)",
    pass: !skips,
    required: false,
    detail: headings.length ? `levels: ${headings.join(",")}` : "no headings",
  });

  // --- Assets (FR-8: featured + branded OG required before publish) -----------
  if (assets) checks.push(...assetChecks(assets));

  // --- Truthfulness (required — Spark hard constraint) ------------------------
  const markers = (body.match(/\[NEEDS SOURCE\]/g) ?? []).length;
  checks.push({
    id: "needs-source",
    label: "No unresolved [NEEDS SOURCE] markers",
    pass: markers === 0,
    required: true,
    detail: markers ? `${markers} remaining` : undefined,
  });
  checks.push({
    id: "citations",
    label: "All citations verified",
    pass: unverifiedCitations === 0,
    required: true,
    detail: unverifiedCitations ? `${unverifiedCitations} unverified` : undefined,
  });

  // --- Length + readability (advisory) ----------------------------------------
  const target = post.wordCountTarget ?? trackWordTarget(post.contentTier);
  const track = trackLabel(post.contentTier);
  checks.push({
    id: "length",
    label: `Length near target (~${target} words${track ? `, ${track}` : ""})`,
    pass: words >= target * 0.7,
    required: false,
    detail: `${words} words`,
  });
  const flesch = text ? fleschReadingEase(text) : null;
  checks.push({
    id: "readability",
    label: "Readability ≥ 50 (Flesch)",
    pass: flesch === null || flesch >= 50,
    required: false,
    detail: flesch === null ? "too short to score" : `score ${flesch}`,
  });

  return checks;
}

export function requiredChecksPass(checks: CheckResult[]): boolean {
  return checks.every((c) => !c.required || c.pass);
}
