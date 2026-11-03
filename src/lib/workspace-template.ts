import { db } from "@/lib/db";

/**
 * Workspace templates (E-SET-04): a new workspace can start from one the
 * operator already runs — its dials, posting slots and categories, the seven
 * motifs as that team edited them, and its active Topics.
 *
 * ⚠ AN ALLOWLIST, NEVER "EVERY SETTING". A workspace's settings also hold its API
 * keys, OAuth refresh tokens, connected channels and sites, its join domains,
 * campaign and account ids, caches and the engine's bookkeeping — none of which
 * belongs to another company, and some of which would quietly connect the new
 * tenant to the old one's accounts. Only the keys below travel. Autonomy and
 * function modes don't either: a new workspace starts manual, by design.
 * Never copied: keys, connections, the brand kit, people, content.
 */

export const TEMPLATE_PARTS = ["dials", "slots", "motifs", "topics"] as const;
export type TemplatePart = (typeof TEMPLATE_PARTS)[number];

export const TEMPLATE_PART_LABEL: Record<TemplatePart, string> = {
  dials: "Dials — approvals, the queue, social generation, UTM tags, publish day, digest, categories",
  slots: "Posting slots",
  motifs: "The seven motifs, as edited",
  topics: "Active Topics and their phrases",
};

/** The policy dials a workspace may inherit — each one a choice about how to work, not about whose accounts. */
export const TEMPLATE_DIAL_KEYS = [
  "social:require_approval", "social:autoqueue", "social:autogen", "social:autogen_weekly", "social:evergreen_fill",
  "social:auto_image", "social:source", "social:timezone", "social:categories",
  "social:utm_enabled", "social:utm_source", "social:utm_medium", "social:utm_campaign",
  "autopilot:publish_day", "autopilot:weekly_articles", "ideas:social_gate", "blog:auto_seo",
  "keywords:country", "image:quality", "digest:enabled", "digest:hour", "production:autotasks",
] as const;

export const isTemplatePart = (v: string): v is TemplatePart => (TEMPLATE_PARTS as readonly string[]).includes(v);

export type TemplateCounts = Record<TemplatePart, number>;

/** What a workspace would hand on, for the form's labels. */
export async function templateSummary(workspaceId: string): Promise<TemplateCounts> {
  const [dials, slots, motifs, topics] = await Promise.all([
    db.workspaceSetting.count({ where: { workspaceId, key: { in: [...TEMPLATE_DIAL_KEYS] } } }),
    db.postingSlot.count({ where: { workspaceId } }),
    db.motifDirective.count({ where: { workspaceId } }),
    db.topic.count({ where: { workspaceId, status: "active" } }),
  ]);
  return { dials, slots, motifs, topics };
}

/** Copy the chosen parts from `sourceId` into the (new, empty) `targetId`. Returns what was copied. */
export async function copyFromTemplate(sourceId: string, targetId: string, parts: TemplatePart[]): Promise<TemplateCounts> {
  const out: TemplateCounts = { dials: 0, slots: 0, motifs: 0, topics: 0 };
  const want = new Set(parts);
  if (want.has("dials")) {
    const rows = await db.workspaceSetting.findMany({ where: { workspaceId: sourceId, key: { in: [...TEMPLATE_DIAL_KEYS] } }, select: { key: true, value: true } });
    if (rows.length) out.dials = (await db.workspaceSetting.createMany({ data: rows.map((r) => ({ workspaceId: targetId, key: r.key, value: r.value })), skipDuplicates: true })).count;
  }
  if (want.has("slots")) {
    const rows = await db.postingSlot.findMany({ where: { workspaceId: sourceId }, select: { weekday: true, minute: true, enabled: true, category: true } });
    if (rows.length) out.slots = (await db.postingSlot.createMany({ data: rows.map((r) => ({ workspaceId: targetId, ...r })), skipDuplicates: true })).count;
  }
  if (want.has("motifs")) {
    // A fresh history: version 1 of the source's current wording.
    const rows = await db.motifDirective.findMany({ where: { workspaceId: sourceId }, select: { key: true, label: true, summary: true, voice: true, rhythm: true, evidence: true, cta: true } });
    if (rows.length) out.motifs = (await db.motifDirective.createMany({ data: rows.map((r) => ({ workspaceId: targetId, ...r })), skipDuplicates: true })).count;
  }
  if (want.has("topics")) {
    const rows = await db.topic.findMany({ where: { workspaceId: sourceId, status: "active" }, select: { name: true, description: true, keywords: true, priority: true } });
    if (rows.length) out.topics = (await db.topic.createMany({ data: rows.map((r) => ({ workspaceId: targetId, ...r })), skipDuplicates: true })).count;
  }
  return out;
}
