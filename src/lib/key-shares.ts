import { db } from "@/lib/db";
import { SHAREABLE_KEYS, invalidateSettingsCache } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { actorNames } from "@/lib/audit-log";

/**
 * Sharing a key between workspaces (2026-11-15, the owner's order — "give
 * admins, only admins, the ability to share API keys and tokens with other
 * workspaces").
 *
 * The rules, each one a decision:
 *  - Only a person who is an ADMIN of BOTH workspaces can start a share: they
 *    may spend the giver's key, and they may decide what the taker runs on.
 *  - Only the keys in SHAREABLE_KEYS (lib/settings.ts) — services, never an identity.
 *  - A share is a pointer. The taker reads the giver's own row when it needs the
 *    key (getSetting); the value is never copied, shown or stored a second time.
 *  - The giver must store the key itself. A borrowed key, the platform's or the
 *    server's cannot be passed on, so shares never chain.
 *  - The taker's own key always wins; the share waits behind it.
 *  - One giver per key per workspace. A second offer is refused, not swapped in.
 *  - An admin on EITHER side can end it. Removing the key ends every share of it.
 *  - Both workspaces' audit logs record it and both sets of admins are told.
 *
 * ⚠ The provider bills the giver's account for the taker's calls, and their
 * quota is one pool — the page says so where the share is made.
 */

/** How many workspaces one key may be shared with — a bound, not a product limit. */
export const MAX_KEY_SHARES = 50;

const LABELS: Record<string, string> = {
  "api_key:anthropic": "Anthropic (Claude)",
  "api_key:google": "Google (Gemini)",
  "api_key:openai": "OpenAI",
  "api_key:elevenlabs": "ElevenLabs",
  "api_key:heygen": "HeyGen",
  "api_key:tavily": "Tavily",
  "api_key:serper": "Serper",
  "api_key:dataforseo": "DataForSEO",
  "api_key:keywordseverywhere": "Keywords Everywhere",
  "api_key:exa": "Exa",
  "api_key:jina": "Jina Reader",
  "api_key:github": "GitHub",
};

/** The short id the Keys page and the audit log use: "anthropic" for "api_key:anthropic". */
export const shareKeyId = (key: string): string => key.replace(/^api_key:/, "");
export const shareKeyLabel = (key: string): string => LABELS[key] ?? shareKeyId(key);

export type GivenShare = { id: string; key: string; label: string; toWorkspaceId: string; toName: string; toDeleted: boolean; at: Date; by: string | null };

/**
 * `in_use` — the taker runs on it. `own_key` — the taker stores its own, which
 * wins. `giver_no_key` — the giver no longer stores one. `giver_deleted` — the
 * giver was deleted (it may still be restored, and the share with it).
 */
export type TakenState = "in_use" | "own_key" | "giver_no_key" | "giver_deleted";
export type TakenShare = { id: string; key: string; label: string; fromWorkspaceId: string; fromName: string; at: Date; state: TakenState };

/** Which (workspace, key) pairs hold a stored value — never the values themselves. */
async function storedPairs(pairs: Array<{ workspaceId: string; key: string }>): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const rows = await db.workspaceSetting.findMany({
    where: { OR: pairs.map((p) => ({ workspaceId: p.workspaceId, key: p.key })), NOT: { value: "" } },
    select: { workspaceId: true, key: true },
  });
  return new Set(rows.map((r) => `${r.workspaceId}|${r.key}`));
}

/** The shares this workspace gives, for its Keys page. */
export async function sharesGiven(workspaceId: string): Promise<GivenShare[]> {
  const rows = await db.keyShare.findMany({
    where: { fromWorkspaceId: workspaceId },
    orderBy: [{ key: "asc" }, { createdAt: "asc" }],
    select: { id: true, key: true, toWorkspaceId: true, createdAt: true, createdById: true, to: { select: { name: true, deletedAt: true } } },
  });
  const names = await actorNames(rows.map((r) => r.createdById ?? ""));
  return rows.map((r) => ({
    id: r.id, key: r.key, label: shareKeyLabel(r.key), toWorkspaceId: r.toWorkspaceId, toName: r.to.name, toDeleted: Boolean(r.to.deletedAt),
    at: r.createdAt, by: r.createdById ? names.get(r.createdById) ?? null : null,
  }));
}

/** The shares this workspace takes, each with what it is doing right now. */
export async function sharesTaken(workspaceId: string): Promise<TakenShare[]> {
  const rows = await db.keyShare.findMany({
    where: { toWorkspaceId: workspaceId },
    orderBy: [{ key: "asc" }],
    select: { id: true, key: true, fromWorkspaceId: true, createdAt: true, from: { select: { name: true, deletedAt: true } } },
  });
  if (rows.length === 0) return [];
  const stored = await storedPairs([
    ...rows.map((r) => ({ workspaceId, key: r.key })),
    ...rows.map((r) => ({ workspaceId: r.fromWorkspaceId, key: r.key })),
  ]);
  return rows.map((r) => {
    const state: TakenState = stored.has(`${workspaceId}|${r.key}`) ? "own_key"
      : r.from.deletedAt ? "giver_deleted"
      : stored.has(`${r.fromWorkspaceId}|${r.key}`) ? "in_use"
      : "giver_no_key";
    return { id: r.id, key: r.key, label: shareKeyLabel(r.key), fromWorkspaceId: r.fromWorkspaceId, fromName: r.from.name, at: r.createdAt, state };
  });
}

/** Whether this workspace runs on a shared key for ANY of these — the setup guide's "has an AI key". */
export async function hasWorkingSharedKey(workspaceId: string, keys: string[]): Promise<boolean> {
  const rows = await db.keyShare.findMany({
    where: { toWorkspaceId: workspaceId, key: { in: keys }, from: { deletedAt: null } },
    select: { fromWorkspaceId: true, key: true },
  });
  if (rows.length === 0) return false;
  return (await storedPairs(rows.map((r) => ({ workspaceId: r.fromWorkspaceId, key: r.key })))).size > 0;
}

/** The workspace whose key this one would fall back to, if that share works right now. */
export async function sharedKeySource(workspaceId: string, key: string): Promise<string | null> {
  if (!SHAREABLE_KEYS.has(key)) return null;
  const share = await db.keyShare.findUnique({
    where: { toWorkspaceId_key: { toWorkspaceId: workspaceId, key } },
    select: { fromWorkspaceId: true, from: { select: { name: true, deletedAt: true } } },
  });
  if (!share || share.from.deletedAt) return null;
  return (await storedPairs([{ workspaceId: share.fromWorkspaceId, key }])).size ? share.from.name : null;
}

/** The other workspaces this person administers — the only ones they can share a key with. */
export async function shareTargets(userId: string, fromWorkspaceId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.membership.findMany({
    where: { userId, role: "ADMIN", status: "active", workspaceId: { not: fromWorkspaceId }, workspace: { deletedAt: null } },
    select: { workspace: { select: { id: true, name: true } } },
  });
  return rows.map((r) => r.workspace).sort((a, b) => a.name.localeCompare(b.name));
}

export type ShareResult = { ok: true; label: string; other: string } | { ok: false; error: string };

/** Start a share. Every rule is checked here, on the server — the form is only a convenience. */
export async function shareKey(p: { fromWorkspaceId: string; toWorkspaceId: string; key: string; actorId: string }): Promise<ShareResult> {
  if (!SHAREABLE_KEYS.has(p.key)) return { ok: false, error: "That key can't be shared between workspaces." };
  if (p.fromWorkspaceId === p.toWorkspaceId) return { ok: false, error: "Pick a different workspace to share with." };
  const label = shareKeyLabel(p.key);
  const [giverSide, own, target, from, existing, count] = await Promise.all([
    // The action already required ADMIN here; checked again so no other caller can skip it.
    db.membership.findUnique({ where: { userId_workspaceId: { userId: p.actorId, workspaceId: p.fromWorkspaceId } }, select: { role: true, status: true } }),
    db.workspaceSetting.count({ where: { workspaceId: p.fromWorkspaceId, key: p.key, NOT: { value: "" } } }),
    db.membership.findUnique({
      where: { userId_workspaceId: { userId: p.actorId, workspaceId: p.toWorkspaceId } },
      select: { role: true, status: true, workspace: { select: { name: true, deletedAt: true } } },
    }),
    db.workspace.findUnique({ where: { id: p.fromWorkspaceId }, select: { name: true } }),
    db.keyShare.findUnique({
      where: { toWorkspaceId_key: { toWorkspaceId: p.toWorkspaceId, key: p.key } },
      select: { fromWorkspaceId: true, from: { select: { name: true } } },
    }),
    db.keyShare.count({ where: { fromWorkspaceId: p.fromWorkspaceId, key: p.key } }),
  ]);
  if (!from) return { ok: false, error: "That workspace no longer exists." };
  if (giverSide?.status !== "active" || giverSide.role !== "ADMIN") return { ok: false, error: "Only an admin of this workspace can share its keys." };
  if (!own) {
    return { ok: false, error: `This workspace doesn't store a ${label} key of its own, so there is nothing to share. A key it borrows, or the platform's, can't be passed on.` };
  }
  if (!target || target.status !== "active" || target.role !== "ADMIN" || target.workspace.deletedAt) {
    return { ok: false, error: "You can share a key only with a workspace where you are an admin too." };
  }
  const toName = target.workspace.name;
  if (existing?.fromWorkspaceId === p.fromWorkspaceId) return { ok: false, error: `${toName} already uses this workspace's ${label} key.` };
  if (existing) {
    return { ok: false, error: `${toName} already uses a ${label} key shared by ${existing.from.name}. Stop that share on ${toName}'s Keys page first.` };
  }
  if (count >= MAX_KEY_SHARES) return { ok: false, error: `The ${label} key is already shared with ${MAX_KEY_SHARES} workspaces, the most one key can serve.` };

  try {
    await db.keyShare.create({ data: { key: p.key, fromWorkspaceId: p.fromWorkspaceId, toWorkspaceId: p.toWorkspaceId, createdById: p.actorId } });
  } catch {
    // Two admins at once: the unique (workspace, key) pair kept the first.
    return { ok: false, error: `${toName} was given a ${label} key a moment ago. Reload the page to see it.` };
  }
  invalidateSettingsCache();
  const id = shareKeyId(p.key);
  await writeAudit({ workspaceId: p.fromWorkspaceId, actorId: p.actorId, action: "api_key.shared", entityType: "key_share", entityId: id, meta: { withWorkspace: toName, withWorkspaceId: p.toWorkspaceId } });
  await writeAudit({ workspaceId: p.toWorkspaceId, actorId: p.actorId, action: "api_key.share_received", entityType: "key_share", entityId: id, meta: { fromWorkspace: from.name, fromWorkspaceId: p.fromWorkspaceId } });
  return { ok: true, label, other: toName };
}

/**
 * The actor as the OTHER workspace's audit log may name them: their id when
 * they belong there too, otherwise nobody — a workspace's log never names a
 * person who isn't one of its members.
 */
async function actorIn(workspaceId: string, actorId: string | null): Promise<string | null> {
  if (!actorId) return null;
  const m = await db.membership.findUnique({ where: { userId_workspaceId: { userId: actorId, workspaceId } }, select: { status: true } });
  return m?.status === "active" ? actorId : null;
}

/** End one share, from either side. `workspaceId` is the side the admin is acting in. */
export async function stopShare(p: { shareId: string; workspaceId: string; actorId: string }): Promise<ShareResult & { side?: "giver" | "taker" }> {
  const share = await db.keyShare.findUnique({
    where: { id: p.shareId },
    select: { id: true, key: true, fromWorkspaceId: true, toWorkspaceId: true, from: { select: { name: true } }, to: { select: { name: true } } },
  });
  // Not found and not yours read the same: a share id from another workspace tells nothing.
  if (!share || (share.fromWorkspaceId !== p.workspaceId && share.toWorkspaceId !== p.workspaceId)) {
    return { ok: false, error: "That share has already ended." };
  }
  await db.keyShare.deleteMany({ where: { id: share.id } });
  invalidateSettingsCache();
  const side: "giver" | "taker" = share.fromWorkspaceId === p.workspaceId ? "giver" : "taker";
  const id = shareKeyId(share.key);
  const otherId = side === "giver" ? share.toWorkspaceId : share.fromWorkspaceId;
  const otherActor = await actorIn(otherId, p.actorId);
  const giverMeta = { direction: "given", withWorkspace: share.to.name, withWorkspaceId: share.toWorkspaceId, endedBy: side };
  const takerMeta = { direction: "taken", fromWorkspace: share.from.name, fromWorkspaceId: share.fromWorkspaceId, endedBy: side };
  await writeAudit({ workspaceId: share.fromWorkspaceId, actorId: side === "giver" ? p.actorId : otherActor, action: "api_key.share_stopped", entityType: "key_share", entityId: id, meta: giverMeta });
  await writeAudit({ workspaceId: share.toWorkspaceId, actorId: side === "taker" ? p.actorId : otherActor, action: "api_key.share_stopped", entityType: "key_share", entityId: id, meta: takerMeta });
  return { ok: true, label: shareKeyLabel(share.key), other: side === "giver" ? share.to.name : share.from.name, side };
}

/**
 * The giver removed the key: every share of it ends with it, and each taker's
 * admins are told why their key went away. Returns how many ended.
 */
export async function endSharesOfKey(fromWorkspaceId: string, key: string, actorId: string | null): Promise<number> {
  if (!SHAREABLE_KEYS.has(key)) return 0;
  const shares = await db.keyShare.findMany({
    where: { fromWorkspaceId, key },
    select: { id: true, toWorkspaceId: true, from: { select: { name: true } } },
  });
  if (shares.length === 0) return 0;
  await db.keyShare.deleteMany({ where: { id: { in: shares.map((s) => s.id) } } });
  invalidateSettingsCache();
  const id = shareKeyId(key);
  for (const s of shares) {
    await writeAudit({
      workspaceId: s.toWorkspaceId, actorId: await actorIn(s.toWorkspaceId, actorId), action: "api_key.share_stopped", entityType: "key_share", entityId: id,
      meta: { direction: "taken", fromWorkspace: s.from.name, fromWorkspaceId, endedBy: "giver", because: "key_removed" },
    });
  }
  return shares.length;
}
