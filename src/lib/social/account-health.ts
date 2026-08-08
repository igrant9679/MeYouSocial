import { db } from "@/lib/db";
import { notify } from "@/lib/notify";
import { networkFor } from "@/lib/social/networks";
import { troubleWith } from "@/lib/social/overview";
import { zernioConfigured } from "@/lib/zernio";

/**
 * Watch connected social accounts and say something BEFORE a send fails.
 *
 * The motivating incident: CommunityForce's Facebook token died twice on
 * 2026-08-07, and both times it was discovered by a published post failing.
 * Zernio knew — it reports `needsReconnection` and a per-network
 * `platformStatus` — we simply never read them back.
 *
 * ⚠ What this deliberately does NOT alert on is imminent token expiry. See
 * `troubleWith` in overview.ts: X and YouTube tokens are routinely minutes from
 * expiring because Zernio refreshes them, so an expiry alarm would fire hourly
 * about healthy accounts and train everyone to ignore the one that matters.
 *
 * Alerts fire on the TRANSITION into trouble, not on the state, so a broken
 * account is reported once rather than every half hour until someone fixes it.
 */

type Snapshot = {
  accountId: string;
  platform: string;
  displayName: string | null;
  username: string | null;
  status: string;
  needsReconnection: boolean;
  platformStatus: string | null;
  platformStatusReason: string | null;
  intentionalDisconnectAt: Date | null;
  tokenExpiresAt: Date | null;
};

const SELECT = {
  accountId: true, platform: true, displayName: true, username: true, status: true,
  needsReconnection: true, platformStatus: true, platformStatusReason: true,
  intentionalDisconnectAt: true, tokenExpiresAt: true,
} as const;

function isBroken(a: Snapshot): boolean {
  return troubleWith(a)?.severity === "warn";
}

/**
 * Reconcile one workspace's accounts and report anything that just broke.
 *
 * Returns the accounts that transitioned into trouble. Callers that already
 * hold the user's attention (the Connections page's Refresh) can use the
 * return value; the sweep notifies instead.
 */
export async function checkWorkspaceAccountHealth(
  workspaceId: string,
): Promise<{ checked: number; broke: { label: string; reason: string; scheduledAhead: number }[] }> {
  if (!(await zernioConfigured(workspaceId))) return { checked: 0, broke: [] };

  // ⚠ ONLY workspaces already bound to a Zernio profile. This is a health
  // CHECK — it must not bind anything.
  //
  // `syncZernioAccounts` calls `ensureZernioProfile`, which adopts an unclaimed
  // profile or creates a new one. That is right for a human pressing Refresh in
  // their own workspace; it is badly wrong for a sweep running unattended over
  // every workspace on the install. Demo Workspace has no Zernio key of its own,
  // so it falls back to the PLATFORM key, and the first run of this sweep
  // (2026-08-08 20:02Z) duly adopted an unclaimed profile on that key and
  // mirrored CommunityForce's Facebook, Instagram and LinkedIn accounts into
  // Demo. No content referenced them and the binding was reverted, but a
  // workspace with posts would have had them queued against another tenant's
  // accounts. An existing profileId makes ensureZernioProfile a no-op, which is
  // what keeps this call read-only.
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { zernioProfileId: true } });
  if (!ws?.zernioProfileId) return { checked: 0, broke: [] };

  const before = new Map(
    (await db.zernioAccount.findMany({ where: { workspaceId }, select: SELECT })).map((a) => [a.accountId, a]),
  );

  // The reconcile is what actually refreshes health — saveZernioAccount mirrors
  // Zernio's fields onto every row it touches.
  const { syncZernioAccounts } = await import("@/lib/zernio/accounts");
  await syncZernioAccounts(workspaceId);

  const after = await db.zernioAccount.findMany({ where: { workspaceId }, select: SELECT });

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const broke: { label: string; reason: string; scheduledAhead: number }[] = [];

  for (const a of after) {
    const was = before.get(a.accountId);
    // Only the transition. An account already broken when we last looked has
    // been reported; repeating it every sweep is how alerts become wallpaper.
    if (!isBroken(a) || (was && isBroken(was))) continue;

    const scheduledAhead = await db.socialPostTarget.count({
      where: {
        accountId: a.accountId,
        status: { not: "posted" },
        post: { workspaceId, status: "scheduled", scheduledAt: { gte: now, lte: in7 } },
      },
    });
    broke.push({
      label: networkFor(a.platform)?.label ?? a.platform,
      reason: troubleWith(a)!.reason,
      scheduledAhead,
    });
  }

  return { checked: after.length, broke };
}

/** Every workspace with Zernio configured. Called by the sweep. */
export async function sweepAccountHealth(): Promise<{ workspaces: number; alerted: number }> {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } });
  let alerted = 0;

  for (const ws of workspaces) {
    // Guard PER WORKSPACE: one tenant's expired Zernio key must not stop the
    // others being checked, and the name of the one that failed must survive.
    try {
      const { broke } = await checkWorkspaceAccountHealth(ws.id);
      for (const b of broke) {
        const atRisk = b.scheduledAhead > 0
          ? ` ${b.scheduledAhead} scheduled post leg${b.scheduledAhead === 1 ? "" : "s"} in the next 7 days will fail until it's reconnected.`
          : " Nothing is scheduled against it yet.";
        await notify({
          workspaceId: ws.id,
          kind: "account_broken",
          title: `${b.label} can't publish`,
          body: `${b.label} — ${b.reason}.${atRisk}`,
          path: "/admin/connections",
          entityType: "zernioAccount",
        });
        alerted++;
      }
    } catch (e) {
      console.warn(`[account-health] ${ws.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { workspaces: workspaces.length, alerted };
}
