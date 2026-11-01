import { db } from "@/lib/db";
import { isGloballyPaused } from "@/lib/governance";
import { getWorkspaceSettingRaw, getSetting, setPlatformSetting } from "@/lib/settings";
import { env } from "@/lib/env";

/**
 * Deleting a workspace keeps it for RESTORE_DAYS before it's purged (E-SEC-14).
 * Deleting used to drop every row at once, with the Zernio profile, the Unipile
 * mailboxes and the Google sign-ins left connected at the providers and nobody
 * told. Now:
 *
 *   delete   — `deletedAt` set; the engine is paused (its earlier state kept in
 *              `pausedBeforeDelete`); members stop seeing it (getCurrentUser
 *              leaves it out); invitations to it can't be claimed; its API
 *              tokens are refused; the operator and its other admins are told.
 *   restore  — the operator, until `purgeAfter`: it comes back as it was.
 *   purge    — after `purgeAfter` (the metrics sweep) or the operator's "Purge
 *              now": Google sign-ins revoked, Unipile mailboxes removed, the
 *              Zernio profile deleted when it lives in the platform's account,
 *              stored files removed — then the rows. What happened at each
 *              provider is kept for the operator (PURGED_SETTING) and emailed.
 *
 * ⚠ Sweeps that list workspaces take `LIVE_WORKSPACE`; the pause stops the
 * per-entity sweeps (social publish, jobs, the autopilot cycle).
 */

export const RESTORE_DAYS = 30;
export const LIVE_WORKSPACE = { deletedAt: null } as const;
export const PURGED_SETTING = "workspaces:purged";

export async function softDeleteWorkspace(id: string, actorId: string): Promise<{ purgeAfter: Date } | null> {
  const now = new Date();
  const purgeAfter = new Date(now.getTime() + RESTORE_DAYS * 86_400_000);
  const paused = await isGloballyPaused(id);
  const r = await db.workspace.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: now, deletedById: actorId, purgeAfter, pausedBeforeDelete: paused },
  });
  if (!r.count) return null;
  await db.automationState.upsert({ where: { workspaceId: id }, update: { globalPause: true }, create: { workspaceId: id, globalPause: true } });
  return { purgeAfter };
}

export async function restoreWorkspace(id: string): Promise<boolean> {
  const ws = await db.workspace.findUnique({ where: { id }, select: { deletedAt: true, pausedBeforeDelete: true, purgeStartedAt: true } });
  if (!ws?.deletedAt || ws.purgeStartedAt) return false;
  const r = await db.workspace.updateMany({
    where: { id, deletedAt: { not: null }, purgeStartedAt: null },
    data: { deletedAt: null, deletedById: null, purgeAfter: null, pausedBeforeDelete: false },
  });
  if (!r.count) return false;
  if (!ws.pausedBeforeDelete) await db.automationState.updateMany({ where: { workspaceId: id }, data: { globalPause: false } });
  return true;
}

export type PurgeStep = { what: string; ok: boolean; detail: string };
export type PurgeRecord = { id: string; name: string; deletedAt: string | null; purgedAt: string; by: string; steps: PurgeStep[] };

const GOOGLE_SIGNINS: { key: string; label: string }[] = [
  { key: "youtube_oauth:refresh_token", label: "YouTube sign-in" },
  { key: "ganalytics_oauth:refresh_token", label: "Google Analytics sign-in" },
];

/** Revoke a Google refresh token. 400 = already invalid (revoked or expired), which is the goal too. */
async function revokeGoogle(token: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return { ok: true, detail: "revoked at Google" };
  if (res.status === 400) return { ok: true, detail: "already invalid at Google" };
  return { ok: false, detail: `Google answered ${res.status}` };
}

/**
 * Purge a deleted workspace: each provider first, then the rows. Claimed with a
 * conditional update (`purgeStartedAt`), so the sweep and the operator's button
 * can't both run it; a purge that died part-way can be run again after an hour.
 * Every step is attempted and its outcome kept — one provider refusing doesn't
 * stop the others, and the operator is told what to clean up by hand.
 */
export async function purgeWorkspace(id: string, by: string): Promise<PurgeRecord | null> {
  const stale = new Date(Date.now() - 3_600_000);
  const claimed = await db.workspace.updateMany({
    where: { id, deletedAt: { not: null }, OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: stale } }] },
    data: { purgeStartedAt: new Date() },
  });
  if (!claimed.count) return null;
  const ws = await db.workspace.findUniqueOrThrow({ where: { id }, select: { name: true, deletedAt: true, zernioProfileId: true } });
  const steps: PurgeStep[] = [];
  const attempt = async (what: string, run: () => Promise<{ ok: boolean; detail: string }>) => {
    try { steps.push({ what, ...(await run()) }); } catch (e) { steps.push({ what, ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : "failed" }); }
  };

  for (const g of GOOGLE_SIGNINS) {
    const stored = await getWorkspaceSettingRaw(id, g.key);
    if (!stored) continue;
    await attempt(g.label, async () => {
      const { decryptSecret } = await import("@/lib/blog-crypto");
      return revokeGoogle(decryptSecret(JSON.parse(stored)));
    });
  }

  const mailboxes = await db.unipileAccount.findMany({ where: { workspaceId: id }, select: { accountId: true, name: true } });
  for (const m of mailboxes) {
    await attempt(`Unipile mailbox ${m.name ?? m.accountId}`, async () => {
      const { deleteUnipileAccount } = await import("@/lib/unipile");
      return deleteUnipileAccount(m.accountId);
    });
  }

  if (ws.zernioProfileId) {
    const profile = ws.zernioProfileId;
    await attempt(`Zernio profile ${profile}`, async () => {
      // A workspace on its own Zernio key keeps its profile in ITS account —
      // that account is the company's, not ours to clear out.
      if (await getWorkspaceSettingRaw(id, "zernio:api_key")) return { ok: true, detail: "left in the company's own Zernio account" };
      const { zernioDelete } = await import("@/lib/zernio");
      await zernioDelete(`/profiles/${encodeURIComponent(profile)}`, null);
      return { ok: true, detail: "deleted in the platform's Zernio account" };
    });
  }

  const files = await db.storedObject.findMany({ where: { workspaceId: id }, select: { key: true } });
  if (files.length) {
    await attempt(`${files.length} stored file${files.length === 1 ? "" : "s"}`, async () => {
      const { storage } = await import("@/lib/storage");
      const gone: string[] = [];
      for (const f of files) if (await storage.remove(f.key).catch(() => false)) gone.push(f.key);
      await db.storedObject.deleteMany({ where: { key: { in: gone } } });
      const removed = gone.length;
      // Rows of files that couldn't be removed outlive the workspace with no
      // owner (SetNull): only the operator can open them, never "anyone".
      return removed === files.length
        ? { ok: true, detail: "removed from storage" }
        : { ok: false, detail: `${removed} removed; ${files.length - removed} left in storage, openable only by the operator` };
    });
  }

  const record: PurgeRecord = { id, name: ws.name, deletedAt: ws.deletedAt?.toISOString() ?? null, purgedAt: new Date().toISOString(), by, steps };
  await db.workspace.delete({ where: { id } });
  await rememberPurge(record);
  await tellOperator(`“${ws.name}” was purged`, purgeSummary(record));
  return record;
}

export function purgeSummary(r: PurgeRecord): string {
  if (!r.steps.length) return "Nothing was connected at a provider.";
  return r.steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.what}: ${s.detail}`).join("\n");
}

async function rememberPurge(r: PurgeRecord): Promise<void> {
  let list: PurgeRecord[] = [];
  try { list = JSON.parse((await getSetting(PURGED_SETTING)) || "[]") as PurgeRecord[]; } catch { /* start again */ }
  await setPlatformSetting(PURGED_SETTING, JSON.stringify([r, ...list].slice(0, 50)));
}

export async function purgedWorkspaces(): Promise<PurgeRecord[]> {
  try { return JSON.parse((await getSetting(PURGED_SETTING)) || "[]") as PurgeRecord[]; } catch { return []; }
}

/** The sweep's half: every deleted workspace past its restore window. */
export async function purgeDueWorkspaces(): Promise<number> {
  const due = await db.workspace.findMany({ where: { deletedAt: { not: null }, purgeAfter: { lte: new Date() } }, select: { id: true } });
  let n = 0;
  for (const w of due) if (await purgeWorkspace(w.id, "the restore window ending")) n++;
  return n;
}

/**
 * The platform operator hears about deletes, restores and purges: an Inbox
 * notification in a workspace they still belong to (it emails them as their
 * preferences say). With no live membership there's nothing to post into — the
 * Workspaces page still lists it.
 */
export async function tellOperator(title: string, body: string): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) return;
  const op = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, memberships: { where: { status: "active", workspace: LIVE_WORKSPACE }, select: { workspaceId: true }, take: 1, orderBy: { createdAt: "asc" } } },
  });
  const ws = op?.memberships[0]?.workspaceId;
  if (!op || !ws) return;
  const { notify } = await import("@/lib/notify");
  await notify({ workspaceId: ws, kind: "security", title: title.slice(0, 200), body, path: "/admin/workspaces#deleted", userIds: [op.id] });
}
