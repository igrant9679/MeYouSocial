import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Queue · Sent · Drafts — Socialmonials' three list tabs (2026-10-17). One
 * query builder for all three so a filter means the same thing on each.
 *
 *   queue  — scheduled to go out (status scheduled | publishing), soonest first
 *   sent   — out, or tried and failed (posted | partial | failed), newest first
 *   drafts — not going anywhere until someone acts (status draft), including
 *            posts held for approval, newest first
 *
 * Filters: free-text search, category, type, social profile (a connected
 * account), source. "Type" is per tab — on the queue it separates a post
 * scheduled at a chosen time from one that took a posting slot (the slot
 * grid is wall clock, so "queued" = scheduledAt lands on a slot instant).
 */

export type ListTab = "queue" | "sent" | "drafts";

export const SOURCES = [
  { value: "manual", label: "Composed" },
  { value: "engine", label: "Engine" },
  { value: "evergreen", label: "Evergreen repost" },
  { value: "import", label: "CSV import" },
  { value: "assistant", label: "Assistant" },
  { value: "captions", label: "Caption Studio" },
  { value: "rss", label: "RSS" },
] as const;
export type SourceValue = (typeof SOURCES)[number]["value"];

/** Older rows have no `source`: derive it the only honest way the data allows. */
export function sourceOf(p: { source: string | null; recycledFromId: string | null; createdById: string | null }): SourceValue {
  if (p.source && SOURCES.some((s) => s.value === p.source)) return p.source as SourceValue;
  if (p.recycledFromId) return "evergreen";
  if (!p.createdById) return "engine";
  return "manual";
}

export const TYPES: Record<ListTab, Array<{ value: string; label: string }>> = {
  queue: [
    { value: "queued", label: "Queued (took a slot)" },
    { value: "scheduled", label: "Scheduled (chosen time)" },
  ],
  sent: [
    { value: "posted", label: "Posted" },
    { value: "partial", label: "Partly posted" },
    { value: "failed", label: "Failed" },
  ],
  drafts: [
    { value: "draft", label: "Draft" },
    { value: "pending", label: "Awaiting approval" },
    { value: "changes", label: "Changes requested" },
  ],
};

export type ListFilter = { q?: string; category?: string; type?: string; profile?: string; source?: string; page?: number };

export const PAGE_SIZE = 40;

export const listInclude = {
  targets: { select: { id: true, provider: true, accountId: true, accountName: true, status: true, error: true, platformPostUrl: true, postedAt: true } },
  campaign: { select: { name: true, color: true } },
  topic: { select: { name: true } },
} satisfies Prisma.SocialPostInclude;

export type ListRow = Prisma.SocialPostGetPayload<{ include: typeof listInclude }>;

export async function loadPostList(workspaceId: string, tab: ListTab, f: ListFilter) {
  const where: Prisma.SocialPostWhereInput = { workspaceId };
  if (tab === "queue") where.status = { in: ["scheduled", "publishing"] };
  else if (tab === "sent") where.status = { in: ["posted", "partial", "failed"] };
  else where.status = "draft";

  const and: Prisma.SocialPostWhereInput[] = [];
  const q = (f.q ?? "").trim();
  if (q) and.push({ text: { contains: q, mode: "insensitive" } });
  if (f.category === "__none__") and.push({ category: null });
  else if (f.category) and.push({ category: f.category });
  if (f.profile) and.push({ targets: { some: { accountId: f.profile } } });
  // Source: a stamped value, OR an unstamped row whose derivation matches.
  // ⚠ Spelled out with explicit nulls — Prisma's NOT drops NULL rows.
  if (f.source) {
    const legacy: Prisma.SocialPostWhereInput =
      f.source === "evergreen" ? { source: null, recycledFromId: { not: null } }
      : f.source === "engine" ? { source: null, recycledFromId: null, createdById: null }
      : f.source === "manual" ? { source: null, recycledFromId: null, createdById: { not: null } }
      : { id: "__never__" };
    and.push({ OR: [{ source: f.source }, legacy] });
  }
  if (tab === "sent" && f.type) and.push({ status: f.type });
  if (tab === "drafts" && f.type === "pending") and.push({ approval: "pending" });
  else if (tab === "drafts" && f.type === "changes") and.push({ approval: "changes" });
  else if (tab === "drafts" && f.type === "draft") and.push({ OR: [{ approval: null }, { approval: { notIn: ["pending", "changes"] } }] });
  if (and.length) where.AND = and;

  const orderBy: Prisma.SocialPostOrderByWithRelationInput[] =
    tab === "queue" ? [{ scheduledAt: "asc" }] : tab === "sent" ? [{ publishedAt: "desc" }, { updatedAt: "desc" }] : [{ updatedAt: "desc" }];

  const page = Math.max(1, f.page ?? 1);
  // Queue "type" needs the slot grid, so it is filtered after the read; the
  // queue is small (a few weeks of slots), so read it whole in that case.
  const queueTyped = tab === "queue" && (f.type === "queued" || f.type === "scheduled");
  const [rowsRaw, total] = await Promise.all([
    db.socialPost.findMany({
      where,
      orderBy,
      include: listInclude,
      skip: queueTyped ? 0 : (page - 1) * PAGE_SIZE,
      take: queueTyped ? 500 : PAGE_SIZE,
    }),
    db.socialPost.count({ where }),
  ]);

  let rows = rowsRaw;
  let slotMinutes = new Set<number>();
  if (tab === "queue") {
    const { getQueue } = await import("@/lib/social/slots");
    // Every slot instant ahead, taken or free — a queued post sits on one.
    const view = await getQueue(workspaceId, { limit: 400 });
    slotMinutes = new Set(view.upcoming.map((s) => Math.floor(s.at.getTime() / 60_000)));
    if (queueTyped) {
      rows = rowsRaw.filter((r) => {
        const onSlot = r.scheduledAt ? slotMinutes.has(Math.floor(r.scheduledAt.getTime() / 60_000)) : false;
        return f.type === "queued" ? onSlot : !onSlot;
      });
    }
  }
  const filteredTotal = queueTyped ? rows.length : total;
  if (queueTyped) rows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const creatorIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => Boolean(v)))];
  const creators = creatorIds.length
    ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const creatorName = new Map(creators.map((u) => [u.id, u.name ?? u.email]));

  return {
    rows: rows.map((r) => ({
      row: r,
      source: sourceOf(r),
      addedBy: r.createdById ? creatorName.get(r.createdById) ?? "a former member" : null,
      onSlot: r.scheduledAt ? slotMinutes.has(Math.floor(r.scheduledAt.getTime() / 60_000)) : false,
    })),
    total: filteredTotal,
    page,
    pages: Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE)),
  };
}

/** Per-tab counts for the strip and the tab headers. */
export async function listCounts(workspaceId: string) {
  const [queue, sent, drafts] = await Promise.all([
    db.socialPost.count({ where: { workspaceId, status: { in: ["scheduled", "publishing"] } } }),
    db.socialPost.count({ where: { workspaceId, status: { in: ["posted", "partial", "failed"] } } }),
    db.socialPost.count({ where: { workspaceId, status: "draft" } }),
  ]);
  return { queue, sent, drafts };
}
