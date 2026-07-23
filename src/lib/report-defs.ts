import { db } from "@/lib/db";

/**
 * Reports hub — the block catalog and the ten stock reports.
 *
 * A report is nothing but an ordered list of block keys plus a date range.
 * Stock reports live here as code defaults; a ReportConfig row appears only
 * when a workspace customizes one (or builds a custom report), so defaults can
 * improve without leaving stale copies behind.
 */

export const BLOCK_KEYS = [
  "kpis",
  "impressions_chart",
  "clicks_chart",
  "movers",
  "posts_table",
  "position_buckets",
  "pipeline_bars",
  "velocity",
  "autopilot_budget",
  "autopilot_feed",
  "compliance",
  "motif_mix",
  "social_table",
  "video_table",
  "audit_summary",
] as const;
export type BlockKey = (typeof BLOCK_KEYS)[number];

export function isBlockKey(k: string): k is BlockKey {
  return (BLOCK_KEYS as readonly string[]).includes(k);
}

export const BLOCK_LABELS: Record<BlockKey, string> = {
  kpis: "KPI row",
  impressions_chart: "Impressions trend",
  clicks_chart: "Clicks trend",
  movers: "Biggest movers",
  posts_table: "Content table",
  position_buckets: "Keyword position buckets",
  pipeline_bars: "Pipeline bars",
  velocity: "Pipeline velocity",
  autopilot_budget: "Autopilot budget & failures",
  autopilot_feed: "Autopilot activity",
  compliance: "Editorial compliance",
  motif_mix: "Voice mix (motifs)",
  social_table: "Social variants",
  video_table: "Video renders & spend",
  audit_summary: "Content-audit summary",
};

export type StockReport = {
  key: string;
  name: string;
  description: string;
  hue: string;
  blocks: BlockKey[];
};

export const STOCK_REPORTS: StockReport[] = [
  { key: "traffic", name: "Traffic overview", description: "Impressions, clicks, and what moved", hue: "blue", blocks: ["kpis", "impressions_chart", "clicks_chart", "movers"] },
  { key: "content", name: "Content performance", description: "Every post's position, delta, clicks", hue: "rose", blocks: ["kpis", "posts_table", "movers"] },
  { key: "keywords", name: "Keyword rankings", description: "Position buckets and movers", hue: "cyan", blocks: ["position_buckets", "movers", "posts_table"] },
  { key: "velocity", name: "Pipeline velocity", description: "How fast ideas become published posts", hue: "amber", blocks: ["velocity", "pipeline_bars"] },
  { key: "autopilot", name: "Autopilot operations", description: "Budget burn, activity, failures", hue: "violet", blocks: ["autopilot_budget", "autopilot_feed"] },
  { key: "compliance", name: "Editorial compliance", description: "Gates, citations, accessibility", hue: "green", blocks: ["compliance", "audit_summary"] },
  { key: "motifs", name: "Voice & motifs", description: "Which voices your content speaks in", hue: "purple", blocks: ["motif_mix", "posts_table"] },
  { key: "social", name: "Social distribution", description: "Variants per platform and status", hue: "pink", blocks: ["social_table"] },
  { key: "video", name: "Video production", description: "Renders, status, estimated spend", hue: "teal", blocks: ["video_table"] },
  { key: "audit", name: "Content audit", description: "Slop scores and recommendations", hue: "indigo", blocks: ["audit_summary", "compliance"] },
];

export type ResolvedReport = {
  key: string;
  name: string;
  description: string;
  hue: string;
  blocks: BlockKey[];
  dateRangeDays: number;
  isCustom: boolean;
  customized: boolean;
};

function parseBlocks(json: string): BlockKey[] {
  try {
    const raw = JSON.parse(json);
    return Array.isArray(raw) ? raw.filter((b): b is BlockKey => typeof b === "string" && isBlockKey(b)) : [];
  } catch {
    return [];
  }
}

/** All reports for a workspace: stock (with overrides applied) + customs. */
export async function listReports(workspaceId: string): Promise<ResolvedReport[]> {
  const rows = await db.reportConfig.findMany({ where: { workspaceId } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const stock = STOCK_REPORTS.map<ResolvedReport>((s) => {
    const row = byKey.get(s.key);
    return {
      key: s.key,
      name: row?.name ?? s.name,
      description: row?.description ?? s.description,
      hue: s.hue,
      blocks: row ? parseBlocks(row.blocks) : s.blocks,
      dateRangeDays: row?.dateRangeDays ?? 56,
      isCustom: false,
      customized: !!row,
    };
  });
  const customs = rows
    .filter((r) => r.isCustom)
    .map<ResolvedReport>((r) => ({
      key: r.key,
      name: r.name,
      description: r.description ?? "Custom report",
      hue: "indigo",
      blocks: parseBlocks(r.blocks),
      dateRangeDays: r.dateRangeDays,
      isCustom: true,
      customized: true,
    }));
  return [...stock, ...customs];
}

export async function getReport(workspaceId: string, key: string): Promise<ResolvedReport | null> {
  const all = await listReports(workspaceId);
  return all.find((r) => r.key === key) ?? null;
}

export function stockDefault(key: string): StockReport | undefined {
  return STOCK_REPORTS.find((s) => s.key === key);
}
