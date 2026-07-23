import { db } from "@/lib/db";

/**
 * FR-2 — the 7 Motifs tone engine + brand kit.
 *
 * The motifs are LSI Media's framework: seven emotional/rational appeals that
 * dictate voice, angle, evidence and CTA. In this app they are NOT hard-coded
 * prompt text — the seeds below are only what a workspace starts with. Admins
 * edit the directives (every edit snapshots the previous text as a version) and
 * the edited copy is what rides into every generation prompt.
 *
 * Resolution order for a piece of content:
 *   post.motifs (weighted, author's choice)
 *     → workspace MotifDefault, most specific match (tier+audience > tier >
 *       audience > catch-all)
 *     → nothing (prompts simply omit the motif block)
 *
 * Weights are percentages. The highest-weighted motif is the *dominant* one: it
 * sets structure and overall voice. Secondary motifs colour the intro and CTA
 * only — that split is what keeps a blend from turning into mush.
 */

export const MOTIF_KEYS = [
  "visionary",
  "competitive",
  "succinct",
  "sincere",
  "exclusive",
  "social",
  "informative",
] as const;
export type MotifKey = (typeof MOTIF_KEYS)[number];

export function isMotifKey(k: string): k is MotifKey {
  return (MOTIF_KEYS as readonly string[]).includes(k);
}

export type MotifSeed = {
  key: MotifKey;
  label: string;
  summary: string;
  voice: string;
  rhythm: string;
  evidence: string;
  cta: string;
  /** hue token for chips — see globals.css; never a raw hex. */
  hue: string;
};

/** Starting directives, straight from the framework's motif table. */
export const MOTIF_SEEDS: MotifSeed[] = [
  {
    key: "visionary",
    label: "Visionary",
    summary: "Thought leadership and forward-thinking ideas that position the brand as a game changer.",
    voice: "Bold, future-facing and big-picture. Name where the field is heading and what it means for the reader, without hype or hedging.",
    rhythm: "Open on the shift that is already underway. Long, confident sentences for the thesis; short ones to land each implication.",
    evidence: "Named trends, first-party observations and reasoned argument. Do not invent research, market sizes, or adoption figures.",
    cta: "Invite the reader to get ahead of the shift — \"see what's next\" / \"book a strategy call\".",
    hue: "violet",
  },
  {
    key: "competitive",
    label: "Competitive",
    summary: "Creates urgency by showing how the brand beats the alternatives on price, benefits and features.",
    voice: "Direct, comparative and confident. State the trade-offs plainly and say who each option is actually right for.",
    rhythm: "Verdict first, then criterion-by-criterion sections. Parallel structure so the comparison stays easy to scan.",
    evidence: "Feature-level comparisons the reader can verify. Never claim a competitor's price, metric or shortcoming that has not been supplied — flag it [NEEDS SOURCE] instead.",
    cta: "Ask for the comparison decision — \"compare us\" / \"get a quote\".",
    hue: "rose",
  },
  {
    key: "succinct",
    label: "Succinct",
    summary: "Directness — the essential information up front so the reader never has to hunt for it.",
    voice: "Tight, scannable and answer-first. No throat-clearing, no restating the question back to the reader.",
    rhythm: "Answer in the first two sentences, then expand. Short paragraphs, lists where a list is genuinely the clearest form.",
    evidence: "Concrete steps, specifics and definitions. Cut every sentence that does not add information.",
    cta: "Offer the shortest next step — \"get the checklist\".",
    hue: "cyan",
  },
  {
    key: "sincere",
    label: "Sincere",
    summary: "Authenticity — focused on solving real pain points rather than simply selling.",
    voice: "Warm, candid and problem-led. Acknowledge the difficulty honestly before offering a way through it.",
    rhythm: "Open with the reader's situation in their own words. Plain language, first- and second-person, no jargon walls.",
    evidence: "Lived detail and practical guidance. Never fabricate a customer story, quote or outcome.",
    cta: "Open a conversation rather than close a sale — \"let's talk through it\".",
    hue: "amber",
  },
  {
    key: "exclusive",
    label: "Exclusive",
    summary: "Makes the reader feel significant and special through a VIP, insider tone.",
    voice: "Insider and premium. Written as though the reader is being let in on how the work is really done.",
    rhythm: "Measured and deliberate. Fewer, richer sections; specificity is what signals access.",
    evidence: "Behind-the-scenes method and named process detail. Only cite results that were supplied.",
    cta: "Gate the next step — \"request access\".",
    hue: "indigo",
  },
  {
    key: "social",
    label: "Social",
    summary: "Builds community around shared values and invites the reader to join a cause.",
    voice: "Inclusive and values-driven. Speaks as \"we\" to a group the reader would want to belong to.",
    rhythm: "Conversational, generous with white space, built around a shared belief stated early.",
    evidence: "Shared principles, community practice and public commitments. No invented participation numbers.",
    cta: "Invite participation — \"join the conversation\".",
    hue: "green",
  },
  {
    key: "informative",
    label: "Informative",
    summary: "Positions the brand as a consultative knowledge resource that educates.",
    voice: "Consultative and evidence-based. Explains the why behind every recommendation.",
    rhythm: "Logical progression from fundamentals to application. Clear h2 structure, defined terms, worked examples.",
    evidence: "Standards, documented requirements and explained mechanisms. Every checkable claim is either grounded in the supplied context or flagged [NEEDS SOURCE].",
    cta: "Point to the relevant capability — \"see our services\".",
    hue: "blue",
  },
];

export const MOTIF_SEED_BY_KEY = new Map(MOTIF_SEEDS.map((m) => [m.key, m]));

export function motifHue(key: string): string {
  return MOTIF_SEED_BY_KEY.get(key as MotifKey)?.hue ?? "cyan";
}

// ---- Weighted selection -------------------------------------------------------

export type MotifWeight = { key: MotifKey; weight: number };

/** Parse the JSON column; tolerant of junk, always returns a sane list. */
export function parseMotifs(json: string | null | undefined): MotifWeight[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: MotifWeight[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    const weight = Number((item as { weight?: unknown }).weight);
    if (typeof key !== "string" || !isMotifKey(key)) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (out.some((o) => o.key === key)) continue;
    out.push({ key, weight });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Clamp to whole percentages summing to 100, dominant first. Max 3 motifs. */
export function normalizeMotifs(list: MotifWeight[]): MotifWeight[] {
  const picked = list.filter((m) => m.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, 3);
  const total = picked.reduce((s, m) => s + m.weight, 0);
  if (!picked.length || total <= 0) return [];
  const scaled = picked.map((m) => ({ key: m.key, weight: Math.round((m.weight / total) * 100) }));
  // Rounding drift lands on the dominant motif so the blend always totals 100.
  const drift = 100 - scaled.reduce((s, m) => s + m.weight, 0);
  scaled[0].weight += drift;
  return scaled.filter((m) => m.weight > 0);
}

export function serializeMotifs(list: MotifWeight[]): string {
  return JSON.stringify(normalizeMotifs(list));
}

/** Read the `motif_<key>` weight inputs shared by the post + defaults forms. */
export function readMotifWeights(formData: FormData): MotifWeight[] {
  const out: MotifWeight[] = [];
  for (const key of MOTIF_KEYS) {
    const n = parseInt(String(formData.get(`motif_${key}`) ?? ""), 10);
    if (Number.isFinite(n) && n > 0) out.push({ key, weight: Math.min(100, n) });
  }
  return out;
}

export function motifSummaryLabel(list: MotifWeight[]): string {
  if (!list.length) return "workspace default";
  return list.map((m) => `${MOTIF_SEED_BY_KEY.get(m.key)?.label ?? m.key} ${m.weight}%`).join(" + ");
}

// ---- Directives (DB, per workspace) -------------------------------------------

export type Directive = {
  id: string;
  key: string;
  label: string;
  summary: string;
  voice: string;
  rhythm: string;
  evidence: string;
  cta: string;
  version: number;
};

/**
 * Return the workspace's directives, seeding the framework defaults the first
 * time they're needed. Idempotent — safe to call from pages and from jobs.
 */
export async function ensureMotifDirectives(workspaceId: string): Promise<Directive[]> {
  const existing = await db.motifDirective.findMany({ where: { workspaceId } });
  const missing = MOTIF_SEEDS.filter((s) => !existing.some((e) => e.key === s.key));
  if (missing.length) {
    await db.motifDirective.createMany({
      data: missing.map((s) => ({
        workspaceId,
        key: s.key,
        label: s.label,
        summary: s.summary,
        voice: s.voice,
        rhythm: s.rhythm,
        evidence: s.evidence,
        cta: s.cta,
      })),
      skipDuplicates: true,
    });
    return db.motifDirective.findMany({ where: { workspaceId } }).then(sortDirectives);
  }
  return sortDirectives(existing);
}

function sortDirectives<T extends { key: string }>(rows: T[]): T[] {
  const order = new Map(MOTIF_KEYS.map((k, i) => [k as string, i]));
  return [...rows].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

// ---- Defaults by tier / audience ----------------------------------------------

type DefaultRow = { tier: number | null; audience: string | null; motifs: string };

/** Most specific match wins: tier+audience > tier > audience > catch-all. */
export function pickDefault(rows: DefaultRow[], tier: number | null, audience: string | null): MotifWeight[] {
  const aud = (audience ?? "").trim().toLowerCase();
  const matches = rows.filter((r) => {
    const tierOk = r.tier == null || r.tier === tier;
    const rowAud = (r.audience ?? "").trim().toLowerCase();
    const audOk = !rowAud || (!!aud && (aud.includes(rowAud) || rowAud.includes(aud)));
    return tierOk && audOk;
  });
  if (!matches.length) return [];
  const score = (r: DefaultRow) => (r.tier != null ? 2 : 0) + (r.audience ? 1 : 0);
  matches.sort((a, b) => score(b) - score(a));
  return parseMotifs(matches[0].motifs);
}

export type MotifTarget = {
  motifs?: string | null;
  contentTier?: number | null;
  audience?: string | null;
};

/** The effective motif blend for a post: explicit selection, else the default. */
export async function resolveMotifs(workspaceId: string, target: MotifTarget): Promise<MotifWeight[]> {
  const explicit = parseMotifs(target.motifs);
  if (explicit.length) return normalizeMotifs(explicit);
  const rows = await db.motifDefault.findMany({ where: { workspaceId } });
  return normalizeMotifs(pickDefault(rows, target.contentTier ?? null, target.audience ?? null));
}

// ---- Prompt assembly ----------------------------------------------------------

/**
 * The prompt block for a blend. Dominant motif drives structure and voice;
 * secondaries are explicitly scoped to the intro and CTA so a 30% motif cannot
 * hijack the whole piece.
 */
export function motifBlock(directives: Directive[], weights: MotifWeight[]): string | null {
  if (!weights.length) return null;
  const byKey = new Map(directives.map((d) => [d.key, d]));
  const lines = weights
    .map((w, i) => {
      const d = byKey.get(w.key);
      if (!d) return null;
      const role =
        i === 0
          ? "DOMINANT — this motif sets the structure, the angle and the overall voice"
          : "secondary — apply this only to the opening and the call to action";
      return [
        `- ${d.label} (${w.weight}%, ${role})`,
        `  Voice: ${d.voice}`,
        `  Rhythm: ${d.rhythm}`,
        `  Evidence: ${d.evidence}`,
        `  Call to action: ${d.cta}`,
      ].join("\n");
    })
    .filter(Boolean);
  if (!lines.length) return null;
  return `Motif voice (the 7 Motifs tone engine — follow it precisely):\n${lines.join("\n")}`;
}

/** One-liner for short generations (titles, social copy, video hooks). */
export function motifBlockShort(directives: Directive[], weights: MotifWeight[]): string | null {
  if (!weights.length) return null;
  const byKey = new Map(directives.map((d) => [d.key, d]));
  const parts = weights
    .map((w) => {
      const d = byKey.get(w.key);
      return d ? `${d.label} (${w.weight}%): ${d.voice} CTA pattern: ${d.cta}` : null;
    })
    .filter(Boolean);
  return parts.length ? `Motif voice — ${parts.join(" | ")}` : null;
}

/** Convenience: resolve + load directives + render the block in one call. */
export async function motifPromptFor(
  workspaceId: string,
  target: MotifTarget,
  variant: "full" | "short" = "full",
): Promise<string | null> {
  const weights = await resolveMotifs(workspaceId, target);
  if (!weights.length) return null;
  const directives = await ensureMotifDirectives(workspaceId);
  return variant === "full" ? motifBlock(directives, weights) : motifBlockShort(directives, weights);
}

// ---- Per-platform motif mapping ------------------------------------------------

export const MOTIF_PLATFORMS = ["linkedin", "x", "instagram", "facebook", "video"] as const;
export type MotifPlatform = (typeof MOTIF_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<MotifPlatform, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  video: "Short-form video",
};

/**
 * Mapped motif per platform, falling back to the article's own blend. The
 * framework already shifts "Social" onto social media, so an unmapped social
 * platform is not silently forced — the article motif carries unless an admin
 * maps one.
 */
export async function getPlatformMotifs(workspaceId: string): Promise<Partial<Record<MotifPlatform, MotifKey>>> {
  const rows = await db.platformMotif.findMany({ where: { workspaceId } });
  const out: Partial<Record<MotifPlatform, MotifKey>> = {};
  for (const r of rows) {
    if ((MOTIF_PLATFORMS as readonly string[]).includes(r.platform) && isMotifKey(r.motifKey)) {
      out[r.platform as MotifPlatform] = r.motifKey;
    }
  }
  return out;
}

/**
 * The motif line for one platform: the mapped motif at full strength, or the
 * article's own blend when the platform is unmapped.
 */
export function platformMotifWeights(
  mapped: MotifKey | undefined,
  articleWeights: MotifWeight[],
): MotifWeight[] {
  return mapped ? [{ key: mapped, weight: 100 }] : articleWeights;
}

/** Prompt block describing the motif each social platform should be written in. */
export async function platformMotifBlock(
  workspaceId: string,
  platforms: readonly MotifPlatform[],
  articleWeights: MotifWeight[],
): Promise<string | null> {
  const map = await getPlatformMotifs(workspaceId);
  const mappedCount = platforms.filter((p) => map[p]).length;
  if (!mappedCount && !articleWeights.length) return null;
  const directives = await ensureMotifDirectives(workspaceId);
  const byKey = new Map(directives.map((d) => [d.key, d]));
  // Nothing mapped: one voice for all variants — say so plainly rather than
  // repeating the same blend four times as if the channels differed.
  if (!mappedCount) {
    const line = motifBlockShort(directives, articleWeights);
    return line ? `${line}\nWrite every variant in this voice.` : null;
  }
  const lines = platforms
    .map((p) => {
      const weights = platformMotifWeights(map[p], articleWeights);
      if (!weights.length) return null;
      const parts = weights
        .map((w) => {
          const d = byKey.get(w.key);
          return d ? `${d.label} (${w.weight}%) — ${d.voice} CTA pattern: ${d.cta}` : null;
        })
        .filter(Boolean);
      return parts.length ? `- ${PLATFORM_LABELS[p]}: ${parts.join(" ‖ ")}` : null;
    })
    .filter(Boolean);
  return lines.length
    ? `Per-channel motif voice (write each variant in its own motif — they are deliberately different):\n${lines.join("\n")}`
    : null;
}

// ---- Brand kit ------------------------------------------------------------------

export const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];
export type HeadingStyle = {
  px: number;
  marginTop: number;
  marginBottom: number;
  weight?: number;
  lineHeight?: number;
  color?: string;
};

/**
 * Article-scoped heading sizes — deliberately smaller than the hero sizes most
 * themes ship, so an article reads correctly while the semantic H order stands.
 */
export const DEFAULT_HEADING_SPEC: Record<HeadingLevel, HeadingStyle> = {
  h1: { px: 36, marginTop: 0, marginBottom: 20, weight: 700, lineHeight: 1.2 },
  h2: { px: 28, marginTop: 32, marginBottom: 14, weight: 700, lineHeight: 1.25 },
  h3: { px: 22, marginTop: 26, marginBottom: 12, weight: 600, lineHeight: 1.3 },
  h4: { px: 19, marginTop: 22, marginBottom: 10, weight: 600, lineHeight: 1.35 },
  h5: { px: 17, marginTop: 18, marginBottom: 8, weight: 600, lineHeight: 1.4 },
  h6: { px: 15, marginTop: 16, marginBottom: 8, weight: 600, lineHeight: 1.4 },
};

export function parseHeadingSpec(json: string | null | undefined): Record<HeadingLevel, HeadingStyle> {
  const out = { ...DEFAULT_HEADING_SPEC };
  if (!json) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== "object") return out;
  for (const level of HEADING_LEVELS) {
    const v = (raw as Record<string, unknown>)[level];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const num = (x: unknown, fallback: number) => {
      const n = Number(x);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    out[level] = {
      px: num(o.px, DEFAULT_HEADING_SPEC[level].px),
      marginTop: num(o.marginTop, DEFAULT_HEADING_SPEC[level].marginTop),
      marginBottom: num(o.marginBottom, DEFAULT_HEADING_SPEC[level].marginBottom),
      weight: o.weight == null ? DEFAULT_HEADING_SPEC[level].weight : num(o.weight, 600),
      lineHeight: o.lineHeight == null ? DEFAULT_HEADING_SPEC[level].lineHeight : num(o.lineHeight, 1.3),
      color: typeof o.color === "string" && o.color.trim() ? o.color.trim() : undefined,
    };
  }
  return out;
}

export type BrandKitView = {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  logoUrl: string | null;
  footerCredit: string | null;
  toneGuardrails: string | null;
  headingSpec: Record<HeadingLevel, HeadingStyle>;
  featuredImageWidth: number;
  featuredImageHeight: number;
  ogImageWidth: number;
  ogImageHeight: number;
  /** FR-8 asset policy. */
  requireImagesToPublish: boolean;
  aiImagesEnabled: boolean;
  brandInBodyImages: boolean;
  /** false when no row exists yet — the page shows the defaults as placeholders. */
  configured: boolean;
};

const BRAND_DEFAULTS = {
  featuredImageWidth: 1920,
  featuredImageHeight: 1080,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  requireImagesToPublish: true,
  aiImagesEnabled: false,
  brandInBodyImages: false,
};

/** Never writes — an unconfigured workspace reads as sensible defaults. */
export async function getBrandKit(workspaceId: string): Promise<BrandKitView> {
  const row = await db.brandKit.findUnique({ where: { workspaceId } });
  if (!row) {
    return {
      primaryColor: null,
      secondaryColor: null,
      accentColor: null,
      headingFont: null,
      bodyFont: null,
      logoUrl: null,
      footerCredit: null,
      toneGuardrails: null,
      headingSpec: { ...DEFAULT_HEADING_SPEC },
      ...BRAND_DEFAULTS,
      configured: false,
    };
  }
  return {
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    accentColor: row.accentColor,
    headingFont: row.headingFont,
    bodyFont: row.bodyFont,
    logoUrl: row.logoUrl,
    footerCredit: row.footerCredit,
    toneGuardrails: row.toneGuardrails,
    headingSpec: parseHeadingSpec(row.headingSpec),
    featuredImageWidth: row.featuredImageWidth,
    featuredImageHeight: row.featuredImageHeight,
    ogImageWidth: row.ogImageWidth,
    ogImageHeight: row.ogImageHeight,
    requireImagesToPublish: row.requireImagesToPublish,
    aiImagesEnabled: row.aiImagesEnabled,
    brandInBodyImages: row.brandInBodyImages,
    configured: true,
  };
}

/** House style rules that ride into every generation prompt, if set. */
export async function brandGuardrailBlock(workspaceId: string): Promise<string | null> {
  const row = await db.brandKit.findUnique({
    where: { workspaceId },
    select: { toneGuardrails: true },
  });
  const t = row?.toneGuardrails?.trim();
  return t ? `Brand tone guardrails (hard rules, they override style preferences):\n${t.slice(0, 1500)}` : null;
}
