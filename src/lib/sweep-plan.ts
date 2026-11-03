import { db } from "@/lib/db";

/**
 * What the autopilot sweep picks, in one place (E-ENG-05): the cycle in
 * blog-autopilot.ts acts on these, and the Automation page's "Next sweep will…"
 * card reads the same answers without acting. A preview with its own copy of
 * the queries would drift from what the engine does — the whole reason it
 * exists is to say exactly that.
 *
 * Every function here only reads. Imports that reach back into the autopilot
 * are dynamic, as in the cycle.
 */

/** Drafting's per-sweep cap, before the weekly dial. */
export const DRAFTS_PER_SWEEP = 2;
/** Publishing's per-sweep cap. */
export const PUBLISHES_PER_SWEEP = 2;
/** Full autonomy queues at most this many drafts a sweep. */
export const QUEUES_PER_SWEEP = 10;
/** Intel's competitor channels are re-read when older than this (E-IDE-09)… */
export const INTEL_REFRESH_DAYS = 7;
/** …a few per sweep — about three YouTube units each, from a pool other workspaces may share. */
export const INTEL_REFRESH_PER_SWEEP = 3;

/** The competitor channels the next sweep re-reads: the longest-unread first, none read in the last week. */
export async function intelToRefresh(workspaceId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - INTEL_REFRESH_DAYS * 86_400_000);
  const { db } = await import("@/lib/db");
  return db.intelChannel.findMany({
    where: { workspaceId, OR: [{ lastIndexedAt: { lt: cutoff } }, { lastIndexedAt: null }] },
    orderBy: { lastIndexedAt: { sort: "asc", nulls: "first" } },
    take: INTEL_REFRESH_PER_SWEEP,
    select: { id: true, youtubeId: true, name: true, handle: true, lastIndexedAt: true },
  });
}

/**
 * The approved ideas the drafting step takes next: highest priority, then the
 * longest-waiting (DRAFT_ORDER), skipping a change on the live site (retire /
 * merge, a refresh with nothing here to revise) — those wait for a person.
 * `autopilot:weekly_articles` caps a rolling 7 days.
 */
export async function ideasToDraft(workspaceId: string, opts: { write?: boolean } = {}) {
  const { getSetting } = await import("@/lib/settings");
  const weeklyRaw = parseInt(await getSetting("autopilot:weekly_articles", workspaceId).catch(() => ""), 10);
  const weekly = Number.isFinite(weeklyRaw) && weeklyRaw > 0 ? weeklyRaw : null;
  let allowance = DRAFTS_PER_SWEEP;
  let draftedThisWeek = 0;
  if (weekly) {
    draftedThisWeek = await db.auditLog.count({
      where: { workspaceId, action: "blog.draft_generated", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    });
    allowance = Math.min(DRAFTS_PER_SWEEP, Math.max(0, weekly - draftedThisWeek));
  }
  const { ideaChange, linkRefreshTargets, DRAFT_ORDER } = await import("@/lib/idea-drafting");
  const pool = allowance > 0
    ? await linkRefreshTargets(workspaceId, await db.blogIdea.findMany({ where: { workspaceId, status: "approved" }, orderBy: DRAFT_ORDER, take: 50 }), opts)
    : [];
  const draftable = pool.filter((i) => ideaChange(i) !== "site_change");
  return { weekly, draftedThisWeek, allowance, ideas: draftable.slice(0, allowance), waitingForPerson: pool.length - draftable.length };
}

/**
 * The articles the publishing step looks at, oldest first: at final approval,
 * not live yet (or a refresh of a live one), and — in auto mode on the publish
 * day — unscheduled or due; otherwise only a due time a person set. Nothing at
 * all without a connected site. The checks run after this, per article.
 */
export async function publishCandidates(workspaceId: string, mode: string, now = new Date()) {
  let autoToday = mode === "auto";
  let publishDay: number | null = null;
  if (autoToday) {
    // `autopilot:publish_day` (Date#getDay 0–6) — read in the posting timezone, never the server's.
    const { getSetting } = await import("@/lib/settings");
    const day = parseInt(await getSetting("autopilot:publish_day", workspaceId).catch(() => ""), 10);
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      publishDay = day;
      const { getPostingTimeZone, zonedParts } = await import("@/lib/social/slots");
      autoToday = zonedParts(now, await getPostingTimeZone(workspaceId)).weekday === day;
    }
  }
  // Not on WordPress yet — or a refresh, whose publish updates its own post in place.
  const notLive = { OR: [{ wpPostId: null, refreshStartedAt: null }, { wpPostId: { not: null }, refreshStartedAt: { not: null } }] };
  const hasSite = (await db.wordPressConnection.count({ where: { workspaceId } })) > 0;
  const candidates = !hasSite || (mode !== "auto" && mode !== "assisted") ? [] : await db.blogPost.findMany({
    where: autoToday
      ? { workspaceId, status: "final_approval", AND: [notLive, { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }] }
      : { workspaceId, status: "final_approval", ...notLive, scheduledAt: { lte: now } },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });
  return { autoToday, publishDay, hasSite, candidates };
}

/**
 * Unscheduled drafts full autonomy gives a slot, oldest first. Approval-held
 * posts are never among them. ⚠ OR [null, "approved"], NEVER `notIn` — SQL NOT
 * IN drops NULL rows, and ordinary posts have approval NULL. Reads past the ten
 * it may queue: drafts a network would reject are skipped, and ten of them at
 * the front must not stall the rest.
 */
export async function queueableDrafts(workspaceId: string) {
  return db.socialPost.findMany({
    where: { workspaceId, status: "draft", scheduledAt: null, OR: [{ approval: null }, { approval: "approved" }] },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, category: true, text: true },
  });
}

export type SweepPreview = Awaited<ReturnType<typeof previewNextSweep>>;

/** The next sweep: the last check-in plus the interval — "due" once that has passed (the worker runs late, never early). */
export function nextSweepFrom(lastCheckIn: Date, intervalMin: number, now: number): { at: Date; due: boolean } {
  const at = new Date(lastCheckIn.getTime() + intervalMin * 60_000);
  return { at, due: at.getTime() <= now };
}

/**
 * "Next sweep will…" (E-ENG-05): which ideas draft, which articles publish (and
 * which are held, by what), which drafts get which slot — read, never done. The
 * slots are picked the way the sweep picks them but not reserved, so a person
 * queueing in between can take one.
 */
export async function previewNextSweep(workspaceId: string, now = new Date()) {
  const [{ getModes, isGloballyPaused }, { isFullyAutonomous }, { generationsToday, DAILY_AI_BUDGET }] = await Promise.all([
    import("@/lib/governance"), import("@/lib/autonomy"), import("@/lib/blog-autopilot"),
  ]);
  const [paused, modes, used, autonomous] = await Promise.all([
    isGloballyPaused(workspaceId), getModes(workspaceId), generationsToday(workspaceId), isFullyAutonomous(workspaceId),
  ]);
  const overBudget = used >= DAILY_AI_BUDGET;
  const draftingOn = modes.blog_drafting === "assisted" || modes.blog_drafting === "auto";

  const drafting = draftingOn && !overBudget ? await ideasToDraft(workspaceId, { write: false }) : null;

  const pub = await publishCandidates(workspaceId, modes.publishing, now);
  const { blockingChecks } = await import("@/lib/blog-gates");
  const ready: Array<{ id: string; title: string; scheduledAt: Date | null }> = [];
  const held: Array<{ id: string; title: string; failing: string[] }> = [];
  for (const p of pub.candidates) {
    if (ready.length >= PUBLISHES_PER_SWEEP) break;
    const failing = await blockingChecks(workspaceId, p.id);
    if (!failing) continue;
    if (failing.length === 0) ready.push({ id: p.id, title: p.title, scheduledAt: p.scheduledAt });
    else held.push({ id: p.id, title: p.title, failing });
  }

  const queue: { picks: Array<{ id: string; text: string; at: Date }>; refused: number; full: boolean; considered: number } = { picks: [], refused: 0, full: false, considered: 0 };
  if (autonomous) {
    const drafts = await queueableDrafts(workspaceId);
    queue.considered = drafts.length;
    if (drafts.length) {
      const [{ getQueue, pickFreeSlot }, { scheduleRefusal }] = await Promise.all([import("@/lib/social/slots"), import("@/lib/social/validate")]);
      let remaining = (await getQueue(workspaceId, { limit: 2000 })).free;
      for (const d of drafts) {
        if (await scheduleRefusal(d.id)) { queue.refused++; continue; }
        const slot = pickFreeSlot(remaining, d.category);
        if (!slot) { queue.full = true; break; }
        queue.picks.push({ id: d.id, text: d.text, at: slot.at });
        remaining = remaining.filter((f) => f.at.getTime() !== slot.at.getTime());
        if (queue.picks.length >= QUEUES_PER_SWEEP) break;
      }
    }
  }

  // E-IDE-09: competitor channels due a re-read — only when a real YouTube key is there.
  const { youtubeConfigured } = await import("@/lib/youtube");
  const youtube = await youtubeConfigured(workspaceId);
  const intel = { youtube, picks: youtube ? await intelToRefresh(workspaceId, now) : [] };

  return {
    paused,
    overBudget,
    intel,
    modes: { drafting: modes.blog_drafting, publishing: modes.publishing },
    autonomous,
    drafting,
    publishing: { ...pub, candidates: undefined, ready, held },
    queue,
  };
}
