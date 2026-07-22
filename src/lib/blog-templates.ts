// Blog structure templates (Wave A′). Constants, not DB rows — they inform
// outline/draft prompts and never change per-workspace.

export type BlogTemplate = { key: string; name: string; guidance: string };

export const BLOG_TEMPLATES: BlogTemplate[] = [
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
