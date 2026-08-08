import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { getQueue, formatInZone } from "@/lib/social/slots";
import { networkFor } from "@/lib/social/networks";
import { zernioConfigured } from "@/lib/zernio";
import { readJson } from "@/lib/db/json";

/**
 * The Social command centre's data.
 *
 * Two jobs, deliberately separated:
 *
 *   - HEALTH answers "is this thing actually wired up and about to do
 *     something", which is the question every one of this project's outages
 *     turned out to be. Connected accounts, the next send, whether slots exist
 *     at all, whether Zernio has a key for THIS workspace.
 *   - ATTENTION answers "what is waiting on a human". Only things a person can
 *     act on go in it. A panel that lists conditions nobody can fix trains
 *     people to ignore the panel.
 *
 * ⚠ Every count here is measured, never estimated. Where a number can't be
 * known — engagement before the first sync, for instance — the caller renders
 * a dash and the reason, per the truthfulness spine. Nothing in this module
 * invents a figure to fill a card.
 */

export type AttentionSeverity = "warn" | "info";

export type AttentionItem = {
  /** Stable slug — used as the React key and for future dismissal. */
  kind: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  cta: string;
};

export type AccountHealth = {
  id: string;
  platform: string;
  label: string;
  name: string;
  color: string;
  status: string;
  /** Posts already scheduled against this account in the next 7 days. */
  scheduledAhead: number;
};

export type SocialOverview = {
  accounts: AccountHealth[];
  connectedCount: number;
  brokenCount: number;
  zernioReady: boolean;
  timeZone: string;
  timeZoneConfigured: boolean;
  slotsConfigured: boolean;
  freeSlotsAhead: number;
  /** The next post due out, if any. */
  nextSend: { id: string; at: Date; label: string; providers: string[] } | null;
  counts: {
    scheduled: number;
    drafts: number;
    awaitingApproval: number;
    changesRequested: number;
    postedAllTime: number;
    postedLast30: number;
  };
  attention: AttentionItem[];
};

const DAY = 24 * 60 * 60 * 1000;

export async function getSocialOverview(workspaceId: string): Promise<SocialOverview> {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * DAY);
  const last30 = new Date(now.getTime() - 30 * DAY);

  const [accountRows, posts, queue, zernioReady, requireApproval] = await Promise.all([
    db.zernioAccount.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, platform: true, displayName: true, username: true, status: true },
    }),
    db.socialPost.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, text: true, mediaKeys: true, status: true, scheduledAt: true, publishedAt: true,
        approval: true,
        targets: { select: { id: true, provider: true, accountId: true, text: true, mediaKeys: true, status: true, error: true } },
      },
      take: 300,
    }),
    getQueue(workspaceId),
    zernioConfigured(workspaceId),
    getSetting("social:require_approval", workspaceId).catch(() => "").then((v) => v === "true"),
  ]);

  // ── Accounts ──────────────────────────────────────────────────────────────
  const scheduledSoon = posts.filter(
    (p) => p.status === "scheduled" && p.scheduledAt && p.scheduledAt >= now && p.scheduledAt <= in7,
  );
  const perAccountAhead = new Map<string, number>();
  for (const p of scheduledSoon) {
    for (const t of p.targets) {
      perAccountAhead.set(t.accountId, (perAccountAhead.get(t.accountId) ?? 0) + 1);
    }
  }

  const accounts: AccountHealth[] = accountRows.map((a) => {
    const net = networkFor(a.platform);
    return {
      id: a.id,
      platform: a.platform,
      label: net?.label ?? a.platform,
      name: a.displayName ?? a.username ?? net?.label ?? a.platform,
      color: net?.color ?? "var(--mute)",
      status: a.status,
      scheduledAhead: perAccountAhead.get(a.id) ?? 0,
    };
  });
  const connected = accounts.filter((a) => a.status === "connected");
  const broken = accounts.filter((a) => a.status !== "connected");

  // ── Counts ────────────────────────────────────────────────────────────────
  const scheduled = posts.filter((p) => p.status === "scheduled");
  const awaiting = posts.filter((p) => p.approval === "pending");
  const changes = posts.filter((p) => p.approval === "changes");
  const drafts = posts.filter((p) => p.status === "draft" && p.approval !== "pending");
  const posted = posts.filter((p) => ["posted", "partial"].includes(p.status));

  // ── Next send ─────────────────────────────────────────────────────────────
  const upcoming = scheduled
    .filter((p) => p.scheduledAt && p.scheduledAt >= now)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];
  const nextSend = upcoming
    ? {
        id: upcoming.id,
        at: upcoming.scheduledAt!,
        label: formatInZone(upcoming.scheduledAt!, queue.timeZone),
        providers: [...new Set(upcoming.targets.map((t) => t.provider.toLowerCase()))],
      }
    : null;

  // ── Attention ─────────────────────────────────────────────────────────────
  const attention: AttentionItem[] = [];

  if (!zernioReady) {
    attention.push({
      kind: "zernio-missing",
      severity: "warn",
      title: "No Zernio API key for this workspace",
      detail: "Nothing can publish until this workspace has its own key — a Zernio key serves exactly one Zernio user's accounts.",
      href: "/admin/connections",
      cta: "Add the key",
    });
  }

  if (connected.length === 0) {
    attention.push({
      kind: "no-accounts",
      severity: "warn",
      title: "No social accounts connected",
      detail: "Connect accounts through this app's Connect buttons — connecting in Zernio's own dashboard leaves them owned by the wrong user.",
      href: "/admin/connections",
      cta: "Connect accounts",
    });
  }

  if (broken.length > 0) {
    const names = broken.map((a) => a.label).join(", ");
    const atRisk = broken.reduce((n, a) => n + a.scheduledAhead, 0);
    attention.push({
      kind: "accounts-broken",
      severity: "warn",
      title: `${broken.length} account${broken.length === 1 ? "" : "s"} need${broken.length === 1 ? "s" : ""} reconnecting`,
      detail: atRisk > 0
        ? `${names} — ${atRisk} scheduled post leg${atRisk === 1 ? "" : "s"} in the next 7 days will fail until fixed.`
        : `${names}. Nothing is scheduled against ${broken.length === 1 ? "it" : "them"} yet.`,
      href: "/admin/connections",
      cta: "Reconnect",
    });
  }

  if (awaiting.length > 0) {
    attention.push({
      kind: "awaiting-approval",
      severity: "warn",
      title: `${awaiting.length} post${awaiting.length === 1 ? "" : "s"} awaiting approval`,
      detail: "Held until an admin approves. Nothing here can be sent, scheduled or queued.",
      href: "/social/approvals",
      cta: "Review",
    });
  }

  if (changes.length > 0) {
    attention.push({
      kind: "changes-requested",
      severity: "info",
      title: `${changes.length} post${changes.length === 1 ? "" : "s"} sent back for changes`,
      detail: "Editing one resubmits it for approval automatically.",
      href: "/social/approvals",
      cta: "Open",
    });
  }

  // Failed legs — per network, because "1 failed post" hides that three of its
  // four networks went out fine.
  const failedLegs = posts.flatMap((p) =>
    p.targets.filter((t) => t.status === "failed").map((t) => ({ post: p, target: t })),
  );
  if (failedLegs.length > 0) {
    const nets = [...new Set(failedLegs.map((f) => networkFor(f.target.provider)?.label ?? f.target.provider))];
    attention.push({
      kind: "failed-legs",
      severity: "warn",
      title: `${failedLegs.length} failed send${failedLegs.length === 1 ? "" : "s"}`,
      detail: `${nets.join(", ")}. Retry sends only the legs that failed — the ones that posted are left alone.`,
      href: "/social/performance",
      cta: "Retry",
    });
  }

  // Unsent posts a network will certainly reject: over its character limit, or
  // text-only where the network demands media. Both are checked at send, so
  // catching them here is the difference between fixing one now and finding out
  // at 09:00 on a morning nobody is watching.
  const unsent = posts.filter((p) => p.status === "draft" || p.status === "scheduled");
  const overLimit: { id: string; label: string; len: number; limit: number }[] = [];
  const needsImage: { id: string; label: string }[] = [];
  for (const p of unsent) {
    const baseKeys = readJson<string[]>(p.mediaKeys, []);
    for (const t of p.targets) {
      const net = networkFor(t.provider);
      if (!net) continue;
      const text = t.text ?? p.text;
      if (net.charLimit && text.length > net.charLimit) {
        overLimit.push({ id: p.id, label: net.label, len: text.length, limit: net.charLimit });
      }
      const keys = t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : baseKeys;
      if (net.requiresMedia && keys.length === 0) {
        needsImage.push({ id: p.id, label: net.label });
      }
    }
  }
  if (overLimit.length > 0) {
    const worst = overLimit.sort((a, b) => b.len - b.limit - (a.len - a.limit))[0];
    attention.push({
      kind: "over-limit",
      severity: "warn",
      title: `${overLimit.length} post leg${overLimit.length === 1 ? "" : "s"} over the character limit`,
      detail: `Worst: ${worst.len} characters against ${worst.label}'s ${worst.limit}. Tailor that network's copy or shorten the base text.`,
      href: `/social/${worst.id}/edit`,
      cta: "Fix it",
    });
  }
  if (needsImage.length > 0) {
    const nets = [...new Set(needsImage.map((n) => n.label))];
    attention.push({
      kind: "needs-image",
      severity: "warn",
      title: `${needsImage.length} post leg${needsImage.length === 1 ? "" : "s"} need an image`,
      detail: `${nets.join(", ")} cannot accept a text-only post. Attach one or deselect the network.`,
      href: `/social/${needsImage[0].id}/edit`,
      cta: "Fix it",
    });
  }

  if (!queue.slots.some((s) => s.enabled)) {
    attention.push({
      kind: "no-slots",
      severity: "info",
      title: "No posting slots set",
      detail: "Slots are the recurring times the queue sends at. Without them, every post needs a hand-picked date.",
      href: "/social/settings",
      cta: "Set slots",
    });
  } else if (!queue.timeZoneConfigured) {
    attention.push({
      kind: "no-timezone",
      severity: "info",
      title: "Posting timezone not set",
      detail: "Slots are running on UTC because no timezone was chosen — 09:00 may not mean 09:00 to your audience.",
      href: "/social/settings",
      cta: "Set timezone",
    });
  }

  if (requireApproval && drafts.length > 0 && awaiting.length === 0) {
    // Nothing broken — just worth saying, because approval-on plus untouched
    // drafts is the state where people wonder why nothing is going out.
    attention.push({
      kind: "drafts-idle",
      severity: "info",
      title: `${drafts.length} draft${drafts.length === 1 ? "" : "s"} not yet queued`,
      detail: "Approved drafts still need queueing before they'll send.",
      href: "/social/calendar",
      cta: "Queue them",
    });
  }

  const freeSlotsAhead = queue.free.filter((s) => s.at <= in7).length;

  return {
    accounts,
    connectedCount: connected.length,
    brokenCount: broken.length,
    zernioReady,
    timeZone: queue.timeZone,
    timeZoneConfigured: queue.timeZoneConfigured,
    slotsConfigured: queue.slots.some((s) => s.enabled),
    freeSlotsAhead,
    nextSend,
    counts: {
      scheduled: scheduled.length,
      drafts: drafts.length,
      awaitingApproval: awaiting.length,
      changesRequested: changes.length,
      postedAllTime: posted.length,
      postedLast30: posted.filter((p) => p.publishedAt && p.publishedAt >= last30).length,
    },
    attention,
  };
}
