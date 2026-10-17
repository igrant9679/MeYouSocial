import { getSetting, setWorkspaceSetting } from "@/lib/settings";

/**
 * Post categories (Socialmonials parity, 2026-10-17). A post's category was
 * only ever a SLOT LANE — the composer offered just the categories that some
 * posting slot already used, so on a workspace with plain slots there was no
 * category at all (53 posts, none categorised). Socialmonials treats it as a
 * label you file every post under and filter the queue by; this list is that.
 *
 * The defaults are the ones Socialmonials shows (Blog Post, Engagement, Fact
 * Check, Holiday/Special Days, Industry News, Inspirational). They are offered
 * until the workspace saves its own list; "Add category" appends. A category
 * still steers the queue exactly as before: a slot with the same category
 * takes the post first, then a general slot, then any (pickFreeSlot).
 */

export const DEFAULT_CATEGORIES = [
  "Blog Post",
  "Engagement",
  "Fact Check",
  "Holiday/Special Days",
  "Industry News",
  "Inspirational",
];

const KEY = "social:categories";
const MAX = 40;

function parse(raw: string): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX) : null;
  } catch {
    return null;
  }
}

export async function listCategories(workspaceId: string, extra: Array<string | null | undefined> = []): Promise<string[]> {
  const saved = parse(await getSetting(KEY, workspaceId).catch(() => ""));
  const base = saved ?? DEFAULT_CATEGORIES;
  const out: string[] = [];
  for (const c of [...base, ...extra]) {
    const v = (c ?? "").trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/** Append one, keeping the defaults as the starting list the first time. */
export async function addCategory(workspaceId: string, name: string): Promise<string | null> {
  const v = name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!v) return null;
  const current = await listCategories(workspaceId);
  const existing = current.find((c) => c.toLowerCase() === v.toLowerCase());
  if (existing) return existing;
  await setWorkspaceSetting(workspaceId, KEY, JSON.stringify([...current, v].slice(0, MAX)));
  return v;
}
