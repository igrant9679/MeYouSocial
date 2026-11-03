import { db } from "@/lib/db";
import { troubleWith } from "@/lib/social/overview";

/**
 * "Reconnect and retry" (E-SOC-07). A leg that failed because the account lost
 * access used to need three trips: Connections to reconnect, back to the post,
 * Retry. Now the post's page offers one button on such a leg: it records that
 * this leg should go again (`SocialPostTarget.retryOnReconnectAt`) and sends
 * the person straight to the network's connect flow. When the account comes
 * back, the legs that were waiting on it are sent — only those legs.
 *
 * ⚠ What counts as "came back" is evidence of a reconnect, never just a sync
 * that found the account looking fine: Zernio often has no idea a token died
 * (the network said so only when we posted), so retrying on any healthy-
 * looking sync would fire before the person had reconnected anything and fail
 * the same way. The evidence is one of:
 *   • the signed `account.connected` webhook for that account (or the same
 *     handle on the same network, when it came back as a new account);
 *   • a sync that saw the account go from broken to healthy;
 *   • the person saying so — "Check now" on the post.
 *
 * ⚠ The send keeps every rule a send has: approval, the global pause and the
 * paused social queue hold it (it waits, and Check now still works within the
 * day), and `publishSocialPost`'s claim stops two triggers sending it twice.
 */

/** How long a request waits for the reconnect before it is let go. */
export const RETRY_WINDOW_HOURS = 24;

// Facebook calls nearly every error an OAuthException; only code 190 is a
// dead token, so it's that code, not the word, that counts.
const LOST = /reconnect|re-?auth|token|expired|revoked|invalid_grant|unauthori[sz]ed|permission|not authorized|access denied|\b40[13]\b|oauth\w*\W{1,4}#?190\b/i;
// X answers a repeated text with a 403; that is not lost access, and a
// reconnect would not make it go.
const NOT_LOST = /duplicate/i;

/** A send error that reads like the account lost access. */
export function readsLikeLostConnection(error: string | null | undefined): boolean {
  return !!error && LOST.test(error) && !NOT_LOST.test(error);
}

type AccountHealth = Parameters<typeof troubleWith>[0];

/** The account can post: connected, nothing revoked, the network calls it active. */
export function accountHealthy(a: AccountHealth | null | undefined): boolean {
  // `troubleWith` calls a deliberate disconnect "info", not trouble — but it
  // can't post either.
  return !!a && a.status === "connected" && troubleWith(a)?.severity !== "warn";
}

/** A failed leg a reconnect could fix: its account is broken, or its error reads like lost access. */
export function needsReconnect(t: { status: string; error: string | null }, account: AccountHealth | null | undefined): boolean {
  if (t.status !== "failed") return false;
  if (account && !accountHealthy(account)) return true;
  return readsLikeLostConnection(t.error);
}

/** The oldest request still waited on. */
export function retryCutoff(now = new Date()): Date {
  return new Date(now.getTime() - RETRY_WINDOW_HOURS * 3_600_000);
}

const handle = (s: string | null | undefined) => (s ?? "").trim().replace(/^@/, "").toLowerCase();

type Leg = { id: string; postId: string; provider: string; accountId: string; accountName: string | null; retryOnReconnectBy: string | null };
type Account = AccountHealth & { accountId: string; platform: string; username: string | null; displayName: string | null };

/**
 * The account a waiting leg would go out on now, or null. Its own when that is
 * healthy; else a healthy account on the same network with the same handle —
 * a removed-and-reconnected account comes back with a new id. Never a different
 * handle: with two accounts on one network, guessing would post as the wrong one.
 */
export function accountFor(leg: Leg, accounts: Map<string, Account>): Account | null {
  const own = accounts.get(leg.accountId);
  if (own && accountHealthy(own)) return own;
  const want = handle(own?.username ?? leg.accountName);
  if (!want) return null;
  const platform = leg.provider.toLowerCase();
  const same = [...accounts.values()].filter(
    (a) => a.accountId !== leg.accountId && a.platform.toLowerCase() === platform && accountHealthy(a) &&
      (handle(a.username) === want || handle(a.displayName) === want),
  );
  return same.length === 1 ? same[0] : null;
}

export type RetryOutcome = { postId: string; legs: number; sent: boolean; held?: string };

/**
 * Send the legs waiting on a reconnect. `accountIds` are the accounts there is
 * evidence for (a webhook, a broken → healthy sync); `postId` is the person's
 * own "Check now" for one post, which trusts any healthy account.
 */
export async function retryAfterReconnect(
  workspaceId: string,
  scope: { accountIds: string[] } | { postId: string },
): Promise<RetryOutcome[]> {
  const cutoff = retryCutoff();
  // Requests past the day are let go, quietly — the post still offers Retry.
  await db.socialPostTarget.updateMany({
    where: { post: { workspaceId }, retryOnReconnectAt: { lt: cutoff } },
    data: { retryOnReconnectAt: null, retryOnReconnectBy: null },
  });
  if ("accountIds" in scope && scope.accountIds.length === 0) return [];

  const waiting = await db.socialPostTarget.findMany({
    where: {
      post: { workspaceId },
      status: "failed",
      retryOnReconnectAt: { gte: cutoff },
      ...("postId" in scope ? { postId: scope.postId } : {}),
    },
    select: { id: true, postId: true, provider: true, accountId: true, accountName: true, retryOnReconnectBy: true },
  });
  if (!waiting.length) return [];

  const accounts = new Map(
    (await db.zernioAccount.findMany({
      where: { workspaceId },
      select: { accountId: true, platform: true, username: true, displayName: true, status: true, needsReconnection: true, platformStatus: true, platformStatusReason: true, intentionalDisconnectAt: true, tokenExpiresAt: true },
    })).map((a) => [a.accountId, a]),
  );
  const evidence = "accountIds" in scope ? new Set(scope.accountIds) : null;

  const byPost = new Map<string, { leg: Leg; account: Account }[]>();
  for (const leg of waiting) {
    const account = accountFor(leg, accounts);
    if (!account || (evidence && !evidence.has(account.accountId))) continue;
    byPost.set(leg.postId, [...(byPost.get(leg.postId) ?? []), { leg, account }]);
  }
  if (!byPost.size) return [];

  const { isGloballyPaused } = await import("@/lib/governance");
  const { socialQueuePause } = await import("@/lib/social/queue-pause");
  const held = (await isGloballyPaused(workspaceId))
    ? "everything is paused"
    : (await socialQueuePause(workspaceId))
      ? "the social queue is paused"
      : null;

  const { publishSocialPost } = await import("@/lib/social/publish");
  const { notify } = await import("@/lib/notify");
  const { networkFor } = await import("@/lib/social/networks");
  const out: RetryOutcome[] = [];
  for (const [postId, legs] of byPost) {
    if (held) {
      out.push({ postId, legs: legs.length, sent: false, held });
      continue;
    }
    // The claim: clearing the request is what lets exactly one trigger send it.
    const ids = legs.map((l) => l.leg.id);
    const claimed = await db.socialPostTarget.updateMany({
      where: { id: { in: ids }, retryOnReconnectAt: { not: null } },
      data: { retryOnReconnectAt: null, retryOnReconnectBy: null },
    });
    if (claimed.count === 0) continue;
    // A leg whose account came back under a new id goes out on that id.
    for (const { leg, account } of legs) {
      if (account.accountId !== leg.accountId) {
        await db.socialPostTarget.update({
          where: { id: leg.id },
          data: { accountId: account.accountId, accountName: account.displayName ?? account.username ?? leg.accountName },
        });
      }
    }
    await publishSocialPost(postId, { only: ids });

    const after = await db.socialPostTarget.findMany({ where: { id: { in: ids } }, select: { status: true, provider: true } });
    const sent = after.length > 0 && after.every((t) => t.status === "posted");
    out.push({ postId, legs: ids.length, sent });
    // A failure is told by the send itself (alertSendFailure); success is
    // told to whoever asked, since they left the post to go reconnect.
    const askedBy = [...new Set(legs.map((l) => l.leg.retryOnReconnectBy).filter((v): v is string => !!v))];
    if (sent && askedBy.length) {
      const nets = [...new Set(after.map((t) => networkFor(t.provider)?.label ?? t.provider))].join(", ");
      await notify({
        workspaceId,
        kind: "published",
        title: `Sent to ${nets} after the reconnect`,
        body: "The legs that were waiting on the reconnect went out.",
        path: `/social/${postId}`,
        entityType: "social_post",
        entityId: `${postId}:reconnect`,
        userIds: askedBy,
      }).catch(() => 0);
    }
  }
  return out;
}

/**
 * The accounts a sync saw come back — broken before and healthy now, or not
 * there before at all (a removed account connected again gets a new id).
 * Either is evidence of a reconnect; healthy before and after is not.
 */
export function recovered(before: Map<string, AccountHealth>, after: (AccountHealth & { accountId: string })[]): string[] {
  return after.filter((a) => accountHealthy(a) && !accountHealthy(before.get(a.accountId))).map((a) => a.accountId);
}
