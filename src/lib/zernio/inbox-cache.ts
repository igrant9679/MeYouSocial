import { after } from "next/server";
import { db } from "@/lib/db";

/**
 * Engage's three lists — conversations, posts with comments, reviews — kept
 * between visits (SOC-26: they were read from Zernio during every render,
 * 15–29 s a visit).
 *
 * A copy read in the last two minutes is served as it is. An older one is
 * served at once and read again after the response (`after`), so the next
 * view is current. With no copy, or when the person presses Refresh, Zernio is
 * read before the page renders. A person's own reply or delete and a webhook
 * delivery mark the copies stale, so the next view refreshes them. The open
 * thread (messages or comments) is always read live — that is where a reply
 * someone just sent shows.
 *
 * ⚠ Stored in ApiCache with a one-day expiry; past that a copy isn't served
 * (and other ApiCache writers may delete it). Freshness lives in the JSON
 * (`readAt`, `stale`), never in `expiresAt`.
 */

export type InboxListName = "conversations" | "posts" | "reviews";
export type CachedList<T> = {
  rows: T[];
  /** When Zernio was read for these rows; null when it never was. */
  readAt: Date | null;
  /** Served from an older copy while a re-read runs after the response. */
  refreshing: boolean;
  /** The read that failed this time, if one did. */
  error: string | null;
};

const FRESH_MS = 2 * 60_000;
const KEEP_MS = 24 * 60 * 60_000;
const PREFIX = "zernio:inbox:";

type Stored<T> = { rows: T[]; readAt: string; stale?: boolean };

const keyFor = (workspaceId: string, list: InboxListName, net?: string) => `${PREFIX}${workspaceId}:${list}:${net || "all"}`;

// One re-read per list at a time in this process.
const inFlight = new Set<string>();

async function readAndStore<T>(key: string, load: () => Promise<T[]>): Promise<Stored<T>> {
  const stored: Stored<T> = { rows: await load(), readAt: new Date().toISOString() };
  const value = JSON.stringify(stored);
  const expiresAt = new Date(Date.now() + KEEP_MS);
  await db.apiCache.upsert({ where: { key }, update: { value, expiresAt }, create: { key, value, expiresAt } }).catch(() => undefined);
  return stored;
}

async function storedCopy<T>(key: string): Promise<Stored<T> | null> {
  const hit = await db.apiCache.findUnique({ where: { key } }).catch(() => null);
  if (!hit || hit.expiresAt <= new Date()) return null;
  try {
    const s = JSON.parse(hit.value) as Stored<T>;
    return Array.isArray(s.rows) && typeof s.readAt === "string" ? s : null;
  } catch {
    return null;
  }
}

export async function cachedInboxList<T>(opts: {
  workspaceId: string;
  list: InboxListName;
  net?: string;
  /** Read Zernio now (the Refresh link). */
  fresh?: boolean;
  load: () => Promise<T[]>;
}): Promise<CachedList<T>> {
  const key = keyFor(opts.workspaceId, opts.list, opts.net);
  const copy = await storedCopy<T>(key);
  const age = copy ? Date.now() - Date.parse(copy.readAt) : Infinity;

  if (copy && !opts.fresh) {
    const old = copy.stale === true || !(age < FRESH_MS);
    if (old && !inFlight.has(key)) {
      inFlight.add(key);
      after(async () => {
        try { await readAndStore(key, opts.load); } catch { /* the copy stays; the next view tries again */ }
        finally { inFlight.delete(key); }
      });
    }
    return { rows: copy.rows, readAt: new Date(copy.readAt), refreshing: old, error: null };
  }

  try {
    const s = await readAndStore(key, opts.load);
    return { rows: s.rows, readAt: new Date(s.readAt), refreshing: false, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // A failed Refresh keeps what was there, saying when it was read.
    return copy
      ? { rows: copy.rows, readAt: new Date(copy.readAt), refreshing: false, error }
      : { rows: [], readAt: null, refreshing: false, error };
  }
}

/** After a reply, a delete or a webhook: the next view re-reads every list. */
export async function markInboxStale(workspaceId: string): Promise<void> {
  const rows = await db.apiCache.findMany({ where: { key: { startsWith: `${PREFIX}${workspaceId}:` } } }).catch(() => []);
  for (const r of rows) {
    try {
      const s = JSON.parse(r.value) as Stored<unknown>;
      if (s.stale) continue;
      await db.apiCache.update({ where: { key: r.key }, data: { value: JSON.stringify({ ...s, stale: true }) } });
    } catch { /* an unreadable copy is ignored by the reader anyway */ }
  }
}
