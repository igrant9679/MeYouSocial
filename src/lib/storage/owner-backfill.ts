import { baseDb } from "@/lib/db";
import { readJson } from "@/lib/db/json";

/**
 * Owners for the files stored before owners were recorded (2026-11-24, the owner's "Yes, dry run" to the audit's
 * last tenancy note: E-SEC-11, security part 5).
 *
 * Since 2026-10-29 `storage.put` records who owns each file (`StoredObject`), and /uploads and /api/files open an
 * owned file only for that workspace's members. Files stored before then have no row and keep the old rule: any
 * signed-in member of ANY workspace can open one whose link reaches them. The audit left them alone on purpose —
 * guessing owners wrongly could lock LSI or CommunityForce out of their own pictures — and gave the call to the
 * operator.
 *
 * `planOwnerBackfill` is that call's evidence, and writes NOTHING: every place a workspace's rows point at a stored
 * file (CATALOG below), each reference traced to its workspace. A file with no owner row that exactly ONE workspace
 * uses is a candidate; one that two or more use is ambiguous and stays as it is; a file nothing references isn't seen
 * (storage isn't listed) and stays as it is. `applyOwnerBackfill` writes the candidates' rows — the operator's
 * button, never an agent's — re-planning first, so a row someone wrote meanwhile is never overwritten.
 */

// ── finding keys in a value ───────────────────────────────────────────────────────────────────────────

const PATH_KEY = /\/(?:uploads|api\/files)\/([^"'\s)?#<>\\]+)/g;

/** A value that IS a key: trimmed, no spaces, not a URL. */
export function exactKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 4 || s.length > 300 || /\s/.test(s) || /^https?:\/\//i.test(s)) return s.startsWith("/") ? pathKeys(s)[0] ?? null : null;
  if (s.startsWith("/")) return pathKeys(s)[0] ?? null;
  return s;
}

/** Our file paths inside a value (an image URL, an article body): /uploads/<key> and /api/files/<key>. */
export function pathKeys(v: unknown): string[] {
  if (typeof v !== "string" || !v.includes("/")) return [];
  const out: string[] = [];
  for (const m of v.matchAll(PATH_KEY)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}

/** A JSON array of keys (mediaKeys). */
export function jsonKeys(v: unknown): string[] {
  if (typeof v !== "string" || !v.startsWith("[")) return [];
  return readJson<unknown[]>(v, []).map(exactKey).filter((k): k is string => Boolean(k));
}

// ── the plan ──────────────────────────────────────────────────────────────────────────────────────────

export type Ref = { key: string; workspaceId: string; where: string };

export type OwnerPlan = {
  at: string;
  /** Distinct files referenced anywhere. */
  referenced: number;
  /** …that already have an owner row. */
  owned: number;
  /** Owned by a workspace other than the one (and only one) that uses it — worth a look, never changed here. */
  ownedElsewhere: Array<{ key: string; owner: string | null; usedBy: string }>;
  /** No owner row, used by exactly one workspace: what Apply would write. */
  candidates: Array<{ key: string; workspaceId: string; where: string[] }>;
  /** No owner row, used by two or more workspaces: left as they are. */
  ambiguous: Array<{ key: string; workspaceIds: string[]; where: string[] }>;
  /** Candidates per workspace. */
  byWorkspace: Record<string, number>;
  /** Where the references were found, per catalog entry. */
  bySource: Record<string, number>;
};

const PAGE = 1000;

/** Every row of a model, in pages, so a large workspace isn't held in memory at once. */
async function each<T>(find: (skip: number) => Promise<T[]>, use: (row: T) => void): Promise<void> {
  for (let skip = 0; ; skip += PAGE) {
    const rows = await find(skip);
    rows.forEach(use);
    if (rows.length < PAGE) break;
  }
}

/** Every reference to a stored file, with the workspace it belongs to. Read-only. */
export async function collectRefs(): Promise<Ref[]> {
  const refs: Ref[] = [];
  const add = (keys: (string | null)[], workspaceId: string | null | undefined, where: string) => {
    if (!workspaceId) return;
    for (const key of keys) if (key) refs.push({ key, workspaceId, where });
  };
  const channels = new Map((await baseDb.channel.findMany({ select: { id: true, workspaceId: true } })).map((c) => [c.id, c.workspaceId]));
  const db = baseDb;

  await each((skip) => db.workspace.findMany({ where: { logoKey: { not: null } }, select: { id: true, logoKey: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.logoKey)], r.id, "Workspace logo"));
  await each((skip) => db.brandKit.findMany({ where: { logoUrl: { not: null } }, select: { workspaceId: true, logoUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(pathKeys(r.logoUrl), r.workspaceId, "Brand logo URL"));
  await each((skip) => db.mediaItem.findMany({ select: { workspaceId: true, key: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.key)], r.workspaceId, "Media library"));
  await each((skip) => db.brandDocument.findMany({ select: { workspaceId: true, storageKey: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.storageKey)], r.workspaceId, "Brand documents"));
  await each((skip) => db.socialPost.findMany({ where: { mediaKeys: { not: "[]" } }, select: { workspaceId: true, mediaKeys: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(jsonKeys(r.mediaKeys), r.workspaceId, "Social posts"));
  await each((skip) => db.socialPostTarget.findMany({ where: { mediaKeys: { not: null } }, select: { mediaKeys: true, post: { select: { workspaceId: true } } }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(jsonKeys(r.mediaKeys), r.post?.workspaceId, "Social posts (per network)"));
  await each((skip) => db.socialTemplate.findMany({ where: { mediaKeys: { not: "[]" } }, select: { workspaceId: true, mediaKeys: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(jsonKeys(r.mediaKeys), r.workspaceId, "Post templates"));
  await each((skip) => db.blogImage.findMany({ select: { url: true, post: { select: { workspaceId: true } } }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([...pathKeys(r.url), ...(r.url.startsWith("/") ? [] : [exactKey(r.url)].filter((k) => k && !k.includes("/")))], r.post?.workspaceId, "Article images"));
  await each((skip) => db.blogPost.findMany({
    where: { OR: [{ body: { contains: "/uploads/" } }, { body: { contains: "/api/files/" } }] },
    select: { workspaceId: true, body: true }, orderBy: { id: "asc" }, skip, take: PAGE,
  }), (r) => add(pathKeys(r.body), r.workspaceId, "Pictures inside articles"));
  await each((skip) => db.asset.findMany({ select: { workspaceId: true, channelId: true, uploadKey: true, url: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.uploadKey), ...pathKeys(r.url)], r.workspaceId ?? (r.channelId ? channels.get(r.channelId) : null), "Video assets"));
  await each((skip) => db.researchSource.findMany({ where: { kind: { in: ["pdf", "word", "text", "image"] } }, select: { channelId: true, ref: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.ref)], channels.get(r.channelId), "Research files"));
  await each((skip) => db.videoRender.findMany({ select: { workspaceId: true, storedUrl: true, assembledUrl: true, voiceoverUrl: true, outputUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([r.storedUrl, r.assembledUrl, r.voiceoverUrl, r.outputUrl].flatMap(pathKeys), r.workspaceId, "Video renders"));
  await each((skip) => db.brandedShort.findMany({ select: { workspaceId: true, storedUrl: true, videoUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([r.storedUrl, r.videoUrl].flatMap(pathKeys), r.workspaceId, "Branded shorts"));
  await each((skip) => db.thumbnail.findMany({ select: { channelId: true, renderUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(pathKeys(r.renderUrl), channels.get(r.channelId), "Thumbnails"));
  await each((skip) => db.youtubeUpload.findMany({ select: { workspaceId: true, sourceKey: true, thumbnailKey: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add([exactKey(r.sourceKey), exactKey(r.thumbnailKey)], r.workspaceId, "YouTube uploads"));
  await each((skip) => db.audienceAvatar.findMany({ select: { channelId: true, photoUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(pathKeys(r.photoUrl), channels.get(r.channelId), "Audience avatars"));
  await each((skip) => db.swipe.findMany({ select: { workspaceId: true, channelId: true, imageUrl: true }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (r) => add(pathKeys(r.imageUrl), r.workspaceId ?? (r.channelId ? channels.get(r.channelId) : null), "Swipe file"));
  return refs;
}

/** The plan, from the references and the owner rows. Pure, so a test reads the same rules. */
export function planFrom(refs: Ref[], owners: Map<string, string | null>, at = new Date()): OwnerPlan {
  const byKey = new Map<string, { ws: Set<string>; where: Set<string> }>();
  const bySource: Record<string, number> = {};
  for (const r of refs) {
    const e = byKey.get(r.key) ?? { ws: new Set<string>(), where: new Set<string>() };
    e.ws.add(r.workspaceId);
    e.where.add(r.where);
    byKey.set(r.key, e);
    bySource[r.where] = (bySource[r.where] ?? 0) + 1;
  }
  const plan: OwnerPlan = { at: at.toISOString(), referenced: byKey.size, owned: 0, ownedElsewhere: [], candidates: [], ambiguous: [], byWorkspace: {}, bySource };
  for (const [key, e] of byKey) {
    const ws = [...e.ws].sort();
    const where = [...e.where].sort();
    if (owners.has(key)) {
      plan.owned++;
      const owner = owners.get(key) ?? null;
      if (ws.length === 1 && owner !== ws[0]) plan.ownedElsewhere.push({ key, owner, usedBy: ws[0] });
      continue;
    }
    if (ws.length === 1) {
      plan.candidates.push({ key, workspaceId: ws[0], where });
      plan.byWorkspace[ws[0]] = (plan.byWorkspace[ws[0]] ?? 0) + 1;
    } else {
      plan.ambiguous.push({ key, workspaceIds: ws, where });
    }
  }
  plan.candidates.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.key.localeCompare(b.key));
  return plan;
}

/** The owner rows for these keys (null workspace = a purged workspace's leftover). */
async function ownersOf(keys: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < keys.length; i += PAGE) {
    const rows = await baseDb.storedObject.findMany({ where: { key: { in: keys.slice(i, i + PAGE) } }, select: { key: true, workspaceId: true } });
    for (const r of rows) out.set(r.key, r.workspaceId);
  }
  return out;
}

/** Read everything, write nothing. */
export async function planOwnerBackfill(): Promise<OwnerPlan> {
  const refs = await collectRefs();
  const keys = [...new Set(refs.map((r) => r.key))];
  return planFrom(refs, await ownersOf(keys));
}

/**
 * The operator's Apply: re-plan now, then write an owner row for each candidate — `skipDuplicates`, so a row written
 * since the plan (by an upload, or a second click) is never replaced. Returns what was written per workspace.
 */
export async function applyOwnerBackfill(): Promise<{ written: number; byWorkspace: Record<string, number> }> {
  const plan = await planOwnerBackfill();
  let written = 0;
  for (let i = 0; i < plan.candidates.length; i += PAGE) {
    const slice = plan.candidates.slice(i, i + PAGE);
    const r = await baseDb.storedObject.createMany({ data: slice.map((c) => ({ key: c.key, workspaceId: c.workspaceId })), skipDuplicates: true });
    written += r.count;
  }
  return { written, byWorkspace: plan.byWorkspace };
}
