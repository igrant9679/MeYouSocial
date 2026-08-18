import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * Posting schedule / queue slots — Buffer's core loop.
 *
 * A workspace defines recurring slots ("09:00 Mon–Fri"); "Add to queue" drops a
 * post into the NEXT FREE one, so the common case never requires picking a
 * datetime. The calendar renders the free slots ahead as ghost chips.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 * Slots are stored as WALL CLOCK (weekday + minutes past local midnight), never
 * as instants, because "09:00 every Tuesday" has to stay 09:00 across a DST
 * change. Turning that wall clock into a real UTC instant needs a timezone, and
 * Railway runs in UTC while the user does not — so the server's own
 * `new Date(y, m, d, h)` is the wrong answer by however many hours the user is
 * offset. Every conversion goes through `zonedTimeToUtc()` below, which uses the
 * workspace's IANA timezone (`social:timezone`) and nothing else.
 *
 * This is the mirror image of the rule the calendar follows: DISPLAY maths runs
 * in the browser (which knows the viewer's zone), RESOLUTION maths runs here
 * (which knows the workspace's zone). Neither may use the server's local zone.
 */

export type PostingSlotRow = {
  id: string;
  weekday: number;
  minute: number;
  enabled: boolean;
  /** Buffer-style content category. Null = general slot, takes anything. */
  category: string | null;
};

/** Used when the workspace hasn't picked one. Honest, if not always right — the
 *  schedule editor nudges the user to save their detected zone. */
export const DEFAULT_TIMEZONE = "UTC";

/** Index = Date#getDay(). */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Display order — Monday first, matching the calendar grid. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** How far ahead the queue will look for a free slot. */
const HORIZON_DAYS = 120;
const DAY_MS = 86_400_000;

// ---- Timezone primitives -------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      // h23 rather than hour12:false — the latter can emit hour "24" on some
      // ICU builds, which quietly shifts the day by one.
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || !/^[A-Za-z0-9+_\-/]{1,64}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock `timeZone` shows at `instant`, expressed as a UTC timestamp. */
function wallClockAsUtc(instant: Date, timeZone: string): number {
  const p: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) p[part.type] = part.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** The zone's UTC offset in ms at that instant (east of UTC is positive). */
function offsetAt(instant: Date, timeZone: string): number {
  return wallClockAsUtc(instant, timeZone) - instant.getTime();
}

/**
 * A local wall clock in `timeZone` → the UTC instant that names it.
 *
 * Two passes: the offset has to be sampled at an instant, but which instant we
 * mean is what we're solving for. The first pass guesses using the offset at the
 * naive timestamp; the second re-samples at that guess, which fixes the case
 * where the guess landed on the far side of a DST transition.
 *
 * Times that don't exist (the skipped hour in spring) resolve to the instant
 * just after the jump rather than throwing — a slot the clock never shows still
 * has to fire on that day.
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let ts = naive - offsetAt(new Date(naive), timeZone);
  ts = naive - offsetAt(new Date(ts), timeZone);
  return new Date(ts);
}

/** What an instant reads as on the wall clock in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): {
  year: number; month: number; day: number; weekday: number; minute: number;
} {
  const d = new Date(wallClockAsUtc(instant, timeZone));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

// ---- Slot formatting -----------------------------------------------------------

/** 545 → "09:05". */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:05" → 545, or null if it isn't a time. */
export function parseMinute(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

// ---- The queue -----------------------------------------------------------------

export async function getPostingTimeZone(workspaceId: string): Promise<string> {
  return (await resolveTimeZone(workspaceId)).timeZone;
}

/** Also reports whether the zone was CHOSEN or is the UTC fallback — the editor
 *  warns about the latter, and "someone deliberately picked UTC" isn't that. */
export async function resolveTimeZone(
  workspaceId: string,
): Promise<{ timeZone: string; configured: boolean }> {
  const raw = (await getSetting("social:timezone", workspaceId).catch(() => "")).trim();
  return isValidTimeZone(raw)
    ? { timeZone: raw, configured: true }
    : { timeZone: DEFAULT_TIMEZONE, configured: false };
}

export async function listPostingSlots(workspaceId: string): Promise<PostingSlotRow[]> {
  const rows = await db.postingSlot.findMany({
    where: { workspaceId },
    orderBy: [{ weekday: "asc" }, { minute: "asc" }],
    select: { id: true, weekday: true, minute: true, enabled: true, category: true },
  });
  // Monday-first, matching how the schedule editor and calendar read.
  return rows.sort(
    (a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday) || a.minute - b.minute,
  );
}

/** A concrete future firing of a slot — the instant plus the slot's category. */
export type UpcomingInstant = { at: Date; category: string | null };

/**
 * Every slot instant strictly after `from`, in ascending order.
 *
 * Walks the LOCAL calendar day by day (not UTC days) so a slot never lands on
 * the wrong side of midnight for the workspace.
 */
export function upcomingSlotInstants(
  slots: PostingSlotRow[], timeZone: string, from: Date, limit = 200,
): UpcomingInstant[] {
  const active = slots.filter((s) => s.enabled);
  if (active.length === 0) return [];

  const out: UpcomingInstant[] = [];
  const start = zonedParts(from, timeZone);
  // A UTC-midnight marker used purely as a local-calendar cursor: we only ever
  // read its Y/M/D and weekday, never treat it as a real instant.
  let cursor = Date.UTC(start.year, start.month - 1, start.day);

  for (let i = 0; i < HORIZON_DAYS && out.length < limit; i++) {
    const c = new Date(cursor);
    const weekday = c.getUTCDay();
    const today = active
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.minute - b.minute);
    for (const s of today) {
      const at = zonedTimeToUtc(
        c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(),
        Math.floor(s.minute / 60), s.minute % 60, timeZone,
      );
      if (at.getTime() > from.getTime()) out.push({ at, category: s.category });
    }
    cursor += DAY_MS;
  }
  return out.slice(0, limit);
}

/** Minute-resolution keys for the instants already claimed by unsent posts. */
async function occupiedMinutes(
  workspaceId: string, from: Date, excludePostId?: string,
): Promise<Set<number>> {
  const rows = await db.socialPost.findMany({
    where: {
      workspaceId,
      status: { in: ["scheduled", "publishing"] },
      scheduledAt: { gte: from },
      ...(excludePostId ? { id: { not: excludePostId } } : {}),
    },
    select: { scheduledAt: true },
  });
  // Minute granularity: a slot is "taken" by anything scheduled in that minute,
  // however it got there (queued, dragged, or typed by hand).
  return new Set(rows.map((r) => Math.floor(r.scheduledAt!.getTime() / 60_000)));
}

export type SlotInstant = { at: Date; taken: boolean; category: string | null };

/** A free slot the queue can claim. */
export type FreeSlot = { at: Date; category: string | null };

export type QueueView = {
  timeZone: string;
  /** False when `timeZone` is the UTC fallback rather than a deliberate choice. */
  timeZoneConfigured: boolean;
  slots: PostingSlotRow[];
  /** Upcoming slot instants with occupancy — drives the calendar's ghost chips. */
  upcoming: SlotInstant[];
  /** Just the free ones, ascending — `pickFreeSlot` decides which one a given
   *  post takes, respecting slot categories. */
  free: FreeSlot[];
};

/**
 * The queue as it stands: the schedule, the slots ahead, and which are free.
 *
 * `excludePostId` lets a post being re-queued ignore the slot it currently
 * occupies, so re-queueing doesn't push it needlessly down the line.
 */
export async function getQueue(
  workspaceId: string,
  opts: { excludePostId?: string; from?: Date; limit?: number } = {},
): Promise<QueueView> {
  const from = opts.from ?? new Date();
  const [{ timeZone, configured }, slots] = await Promise.all([
    resolveTimeZone(workspaceId),
    listPostingSlots(workspaceId),
  ]);
  const instants = upcomingSlotInstants(slots, timeZone, from, opts.limit ?? 200);
  const taken = instants.length ? await occupiedMinutes(workspaceId, from, opts.excludePostId) : new Set<number>();
  const upcoming = instants.map(({ at, category }) => ({
    at, category, taken: taken.has(Math.floor(at.getTime() / 60_000)),
  }));
  return {
    timeZone,
    timeZoneConfigured: configured,
    slots,
    upcoming,
    free: upcoming.filter((s) => !s.taken).map(({ at, category }) => ({ at, category })),
  };
}

/**
 * Which free slot a post of `category` takes — the whole category rule, in one
 * place, written so nothing ever strands:
 *
 *   - a CATEGORIZED post prefers the earliest slot of its own category, then
 *     falls back to the earliest GENERAL (uncategorized) slot;
 *   - an UNCATEGORIZED post prefers the earliest general slot, then falls back
 *     to the earliest slot of any category.
 *
 * A workspace that never touches categories therefore behaves exactly as
 * before, and a fully-categorized schedule still accepts plain posts.
 */
export function pickFreeSlot(free: FreeSlot[], category: string | null | undefined): FreeSlot | null {
  const want = (category ?? "").trim() || null;
  if (want) {
    return free.find((s) => s.category === want) ?? free.find((s) => s.category === null) ?? null;
  }
  return free.find((s) => s.category === null) ?? free[0] ?? null;
}

/** The single next free slot for that category, or null when none. */
export async function nextFreeSlot(
  workspaceId: string, excludePostId?: string, category?: string | null,
): Promise<Date | null> {
  const { free } = await getQueue(workspaceId, { excludePostId, limit: 60 });
  return pickFreeSlot(free, category)?.at ?? null;
}

/** Why a queue request couldn't be honoured — the caller turns this into copy. */
export type QueueFailure = "no-slots" | "full";

/** Copy for the two ways a queue request can come up empty. */
export function queueFailureMessage(reason: QueueFailure): string {
  return reason === "no-slots"
    ? "No posting slots yet — add some under “Posting schedule” below, then try again."
    : "Every slot in the next few months is taken. Add more slots or schedule this one by hand.";
}

/** A slot instant written in the workspace's own zone — "Mon 28 Jul, 09:00". */
export function formatInZone(at: Date, timeZone: string): string {
  return at.toLocaleString("en-GB", {
    timeZone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export async function claimNextFreeSlot(
  workspaceId: string, excludePostId?: string, category?: string | null,
): Promise<{ at: Date } | { error: QueueFailure }> {
  const { slots, free } = await getQueue(workspaceId, { excludePostId, limit: 60 });
  if (slots.filter((s) => s.enabled).length === 0) return { error: "no-slots" };
  const slot = pickFreeSlot(free, category);
  if (!slot) return { error: "full" };
  return { at: slot.at };
}

// ---- Removing a slot -----------------------------------------------------------

/**
 * Posts scheduled into a slot that is being DELETED go back to the queue, and
 * back through approval.
 *
 * ⚠ A deleted slot must not leave posts stranded on an instant the schedule no
 * longer has. Before this, removing a slot left every post already sitting in
 * it scheduled at a time the calendar no longer showed — they would still have
 * gone out at that moment, from a slot the owner believed they had deleted.
 *
 * "Back to the queue" means all three of:
 *   · `scheduledAt` cleared and `status` back to `draft`, so the post is
 *     genuinely unscheduled rather than pointing at a ghost time;
 *   · `approval` set to `pending`, which is what the owner asked for — the
 *     schedule changed under this post, so someone should look at it again.
 *     ⚠ The sweep's claim treats pending as unsendable regardless of the
 *     workspace's `require_approval` setting, so this reliably stops the send
 *     even where approval is otherwise off;
 *   · a `reviewNote` saying why, because a post that silently reappears in
 *     Approvals with no explanation reads as a bug.
 * Re-assignment then happens the normal way: approving it queues it into the
 * next free slot when `social:autoqueue` is on, or the owner queues it.
 *
 * Only FUTURE, still-scheduled posts are touched. Anything already `posted`,
 * `failed` or mid-flight in `publishing` is history or in someone else's hands.
 */
export async function releasePostsFromSlots(
  workspaceId: string,
  removed: Array<{ weekday: number; minute: number }>,
  reason: string,
): Promise<{ released: number; posts: Array<{ id: string; at: Date }> }> {
  if (removed.length === 0) return { released: 0, posts: [] };
  const timeZone = await getPostingTimeZone(workspaceId);
  const wanted = new Set(removed.map((s) => `${s.weekday}:${s.minute}`));

  const scheduled = await db.socialPost.findMany({
    where: { workspaceId, status: "scheduled", scheduledAt: { gte: new Date() } },
    select: { id: true, scheduledAt: true },
  });
  const hit = scheduled.filter((p) => {
    if (!p.scheduledAt) return false;
    const parts = zonedParts(p.scheduledAt, timeZone);
    return wanted.has(`${parts.weekday}:${parts.minute}`);
  });
  if (hit.length === 0) return { released: 0, posts: [] };

  await db.socialPost.updateMany({
    // Re-check the status in the write: the sweep may have claimed one for
    // publishing between the read above and here, and a post already going out
    // must not be dragged back to draft underneath it.
    where: { id: { in: hit.map((p) => p.id) }, status: "scheduled" },
    data: { status: "draft", scheduledAt: null, approval: "pending", approvedById: null, approvedAt: null, reviewNote: reason },
  });
  return { released: hit.length, posts: hit.map((p) => ({ id: p.id, at: p.scheduledAt! })) };
}
