import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { createPostViaUnipile, type PostAttachment, unipileConfigured } from "@/lib/unipile";
import { readJson } from "@/lib/db/json";

/**
 * Publish one composed post to all its pending targets through Unipile. Per-
 * target status is recorded independently, so a 3-network post reflects exactly
 * which legs landed. Idempotent-ish: only PENDING targets are (re)sent, and the
 * post must be in a publishable state — a concurrent sweep that already claimed
 * it (status=publishing) won't double-fire because we re-read pending targets.
 */
export async function publishSocialPost(postId: string): Promise<void> {
  const post = await db.socialPost.findUnique({ where: { id: postId }, include: { targets: true } });
  if (!post) return;

  await db.socialPost.update({ where: { id: post.id }, data: { status: "publishing" } });

  // Load media once (shared across targets).
  let attachments: PostAttachment[] = [];
  const mediaKeys = readJson<string[]>(post.mediaKeys, []);
  if (mediaKeys.length) {
    const loaded = await Promise.all(
      mediaKeys.map(async (key) => {
        const buf = await storage.get(key);
        if (!buf) return null;
        return { bytes: new Uint8Array(buf), filename: key.split("/").pop() || "media" } as PostAttachment;
      }),
    );
    attachments = loaded.filter((a): a is PostAttachment => a !== null);
  }

  const configured = await unipileConfigured();

  for (const target of post.targets) {
    if (target.status === "posted") continue;
    try {
      if (!configured) throw new Error("Unipile is not configured");
      const providerPostId = await createPostViaUnipile({
        accountId: target.unipileAccountId,
        text: post.text,
        attachments,
      });
      await db.socialPostTarget.update({
        where: { id: target.id },
        data: { status: "posted", providerPostId, postedAt: new Date(), error: null },
      });
    } catch (e) {
      await db.socialPostTarget.update({
        where: { id: target.id },
        data: { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
      });
    }
  }

  // Roll up the post status from its targets.
  const fresh = await db.socialPostTarget.findMany({ where: { postId: post.id } });
  const posted = fresh.filter((t) => t.status === "posted").length;
  const status = posted === fresh.length ? "posted" : posted > 0 ? "partial" : "failed";
  await db.socialPost.update({
    where: { id: post.id },
    data: { status, publishedAt: posted > 0 ? new Date() : null },
  });
}

/**
 * Scheduler entry point: publish every scheduled post that's now due. Claims
 * each row (scheduled → publishing) in a guarded update before publishing so a
 * second sweep can't grab the same post.
 */
export async function publishDueSocialPosts(): Promise<number> {
  const due = await db.socialPost.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 50,
  });
  let published = 0;
  for (const { id } of due) {
    // Atomic claim: only proceed if it's still scheduled.
    const claim = await db.socialPost.updateMany({
      where: { id, status: "scheduled" },
      data: { status: "publishing" },
    });
    if (claim.count === 0) continue; // another sweep took it
    try {
      await publishSocialPost(id);
      published++;
    } catch {
      await db.socialPost.updateMany({ where: { id, status: "publishing" }, data: { status: "failed" } });
    }
  }
  return published;
}
