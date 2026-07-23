// Blog structure templates (Wave A′). Constants, not DB rows — they inform
// outline/draft prompts and never change per-workspace.

export type BlogTemplate = { key: string; name: string; guidance: string };

export const BLOG_TEMPLATES: BlogTemplate[] = [
  {
    key: "house",
    name: "House article",
    guidance:
      "The house structure: open by reframing the reader's question into the better question they should be asking; " +
      "a sectioned body of h2s that each answer one part of it; a 'mindset shift' takeaway section that names what " +
      "the reader should now think differently about; and a closing call to action. Where the piece makes claims that " +
      "need evidence, end with a sources list of the verified links.",
  },
  {
    key: "guide",
    name: "Complete guide",
    guidance: "Definitive guide: intro framing the problem, 4-6 h2 sections building from basics to advanced, actionable conclusion.",
  },
  {
    key: "how-to",
    name: "How-to",
    guidance: "Step-by-step tutorial: brief context, prerequisites, numbered h2 steps in doing order, troubleshooting, wrap-up.",
  },
  {
    key: "listicle",
    name: "Listicle",
    guidance: "Numbered list post: strong hook stating the payoff, 5-9 h2 items each with a takeaway, best-pick or summary close.",
  },
  {
    key: "comparison",
    name: "Comparison",
    guidance: "X vs Y: quick-verdict intro, criteria-by-criteria h2 sections, use-case recommendations ('choose X if…'), honest tradeoffs.",
  },
  {
    key: "case-study",
    name: "Case study",
    guidance: "Story arc: situation, challenge, approach, results, lessons. Only claim results that are provided — never invent outcomes.",
  },
  {
    key: "pillar",
    name: "Pillar page",
    guidance: "Broad topic hub: comprehensive overview of every subtopic at moderate depth, each h2 designed to link out to a deeper article.",
  },
];

export function templateGuidance(key: string | null | undefined): string | null {
  return BLOG_TEMPLATES.find((t) => t.key === key)?.guidance ?? null;
}

/**
 * FR-6 track-based length targets: cornerstone pieces run 2,000+ words,
 * service-supporting pieces 1,200–1,800. Tier 1–2 are the cornerstone tracks;
 * 3–4 supporting. No tier set keeps the old generic default.
 */
export function trackWordTarget(contentTier: number | null | undefined): number {
  switch (contentTier) {
    case 1:
      return 2200;
    case 2:
      return 2000;
    case 3:
      return 1600;
    case 4:
      return 1200;
    default:
      return 900;
  }
}

export function trackLabel(contentTier: number | null | undefined): string | null {
  if (contentTier === 1 || contentTier === 2) return "cornerstone";
  if (contentTier === 3 || contentTier === 4) return "service-supporting";
  return null;
}
