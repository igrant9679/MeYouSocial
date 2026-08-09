import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { formatInZone, getQueue, pickFreeSlot, type FreeSlot } from "@/lib/social/slots";

/**
 * Evergreen recycling — refill free queue slots with content that has already
 * proven it can go out.
 *
 * Model: an evergreen SOURCE is a normal post the author flagged. Once it has
 * actually been posted, and its cooldown (`recycleEveryDays`) has elapsed, the
 * sweep CLONES it into a free posting slot. Clones are ordinary scheduled
 * posts — visible in the queue, editable, cancellable — carrying
 * `recycledFromId` so the UI can say where they came from.
 *
 * Why clones rather than re-sending the same row: a SocialPost's targets are
 * its history ("this went out at X to Y"). Re-opening them would overwrite
 * postedAt/platformPostUrl and make the record lie. A clone gives every send
 * its own honest per-leg accounting, and the idempotency request-id derives
 * from the post id, so a clone can never be deduped against its source.
 *
 * Guard rails, each deliberate:
 *   - OPT-IN per workspace (`social:evergreen_fill` = "true", default off) —
 *     automatic posting is the kind of behavior nobody should discover by
 *     surprise. Mock-flag rule applied in reverse: default to NOT acting.
 *   - Only fills slots within the next `FILL_HORIZON_DAYS` — a month of free
 *     slots should not be flooded the moment one post becomes eligible.
 *   - A source with an unsent clone is skipped — one recycle in flight at a
 *     time, so a full queue can't stack duplicates.
 *   - Targets are re-filtered against currently-connected accounts, so a
 *     recycled post doesn't keep hammering a network whose token died.
 *   - Slot categories are honored via the same `pickFreeSlot` rule the queue
 *     uses everywhere else.
 *
 * Runs inside the social sweep's distributed lock — never call it elsewhere.
 */

const FILL_HORIZON_DAYS = 7;
const MAX_CLONES_PER_WORKSPACE_PER_SWEEP = 5;
const DAY_MS = 86_400_000;

export async function recycleEvergreenPosts(): Promise<number> {
  // Only workspaces that actually have evergreen sources are worth the
  // settings read; most installs never touch the feature.
  const wsRows = await db.socialPost.groupBy({
    by: ["workspaceId"],
    where: { evergreen: true, status: { in: ["posted", "partial"] } },
  });
  let cloned = 0;

  for (const { workspaceId } of wsRows) {
    const enabled = (await getSetting("social:evergreen_fill", workspaceId).catch(() => "")) === "true";
    if (!enabled) continue;

    const now = Date.now();
    const queue = await getQueue(workspaceId, { limit: 120 });
    let free: FreeSlot[] = queue.free.filter((s) => s.at.getTime() <= now + FILL_HORIZON_DAYS * DAY_MS);
    if (free.length === 0) continue;

    const connected = new Set(
      (await db.zernioAccount.findMany({
        where: { workspaceId, status: "connected" },
        select: { accountId: true },
      })).map((a) => a.accountId),
    );
    if (connected.size === 0) continue;

    const sources = await db.socialPost.findMany({
      where: {
        workspaceId,
        evergreen: true,
        status: { in: ["posted", "partial"] },
        OR: [{ approval: null }, { approval: "approved" }],
      },
      include: { targets: true },
    });

    // Eligibility that can't be expressed in one WHERE: per-row cooldown, the
    // optional end date, and "no unsent clone already in flight".
    const inFlight = new Set(
      (await db.socialPost.findMany({
        where: {
          workspaceId,
          recycledFromId: { in: sources.map((s) => s.id) },
          status: { in: ["draft", "scheduled", "publishing"] },
        },
        select: { recycledFromId: true },
      })).map((c) => c.recycledFromId!),
    );

    const eligible = sources
      .filter((s) => !inFlight.has(s.id))
      .filter((s) => !s.recycleUntil || s.recycleUntil.getTime() > now)
      .map((s) => ({ s, lastOut: (s.lastRecycledAt ?? s.publishedAt ?? s.createdAt).getTime() }))
      .filter(({ s, lastOut }) => lastOut <= now - Math.max(1, s.recycleEveryDays) * DAY_MS)
      // Least-recently-out first — the fairest rotation through the library.
      .sort((a, b) => a.lastOut - b.lastOut)
      .map(({ s }) => s);

    let clonedHere = 0;
    for (const source of eligible) {
      if (clonedHere >= MAX_CLONES_PER_WORKSPACE_PER_SWEEP) break;
      const slot = pickFreeSlot(free, source.category);
      if (!slot) break; // nothing this or any fallback category can take

      const targets = source.targets.filter((t) => connected.has(t.accountId));
      if (targets.length === 0) continue; // every original account is gone

      const clone = await db.socialPost.create({
        data: {
          workspaceId,
          createdById: source.createdById,
          topicId: source.topicId,
          campaignId: source.campaignId,
          category: source.category,
          text: source.text,
          mediaKeys: source.mediaKeys,
          scheduledAt: slot.at,
          status: "scheduled",
          evergreen: false, // clones never re-recycle — cadence stays on the source
          recycledFromId: source.id,
          // The source was approved (or predates the workflow); its content is
          // unchanged, so the clone inherits that standing.
          approval: source.approval,
          targets: {
            create: targets.map((t) => ({
              provider: t.provider,
              accountId: t.accountId,
              accountName: t.accountName,
              text: t.text,
              mediaKeys: t.mediaKeys,
              // A clone republishes the SAME content, so it must go out in the
              // same shape — a source Story that recycled as a feed post would
              // be a different post wearing its name.
              subFormat: t.subFormat,
            })),
          },
        },
      });
      await db.socialPost.update({
        where: { id: source.id },
        data: { lastRecycledAt: new Date(), timesRecycled: { increment: 1 } },
      });
      // A clone of a pre-auto-image source has no media; give it the same
      // default-to-image treatment as a composed post.
      if (source.mediaKeys === "[]") {
        const { jobs } = await import("@/lib/jobs");
        await jobs.enqueue("social.autoimage", { postId: clone.id }, { refId: clone.id, workspaceId });
      }
      await writeAudit({
        workspaceId,
        action: "social.recycled",
        entityType: "social_post",
        entityId: clone.id,
        meta: { sourceId: source.id, scheduledAt: slot.at.toISOString() },
      });
      await notify({
        workspaceId,
        kind: "scheduled",
        title: `Evergreen post recycled into ${formatInZone(slot.at, queue.timeZone)}`,
        body: source.text.slice(0, 140),
        path: "/social",
        entityType: "social_post",
        entityId: clone.id,
      });

      // Claim the slot locally so this sweep can't double-book it.
      free = free.filter((f) => f.at.getTime() !== slot.at.getTime());
      clonedHere++;
      cloned++;
    }
  }
  return cloned;
}
