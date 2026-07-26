import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { readJson } from "@/lib/db/json";
import { tagLinksForNetwork } from "@/lib/social/utm";
import {
  createZernioPost,
  uploadZernioMedia,
  zernioConfigured,
  type ZernioMediaItem,
  type ZernioPostTargetSpec,
} from "@/lib/zernio";

/**
 * Publish one composed post to all its pending targets, through Zernio.
 *
 * ── One API call, not one per network ───────────────────────────────────────
 * The Unipile version looped and posted per target. Zernio takes the whole
 * fan-out in a single `POST /posts` with a `platforms[]` array and reports
 * per-platform status back — fewer round trips, and a better match for how
 * SocialPostTarget already models things. Per-network text and media overrides
 * map onto `content` / `customMedia` inside each platform entry.
 *
 * ── Not posting twice ───────────────────────────────────────────────────────
 * Four independent guards, because a duplicate here reaches a real audience:
 *   1. the scheduler lock (src/lib/lock.ts) — one replica sweeps at a time;
 *   2. the atomic status claim in `publishDueSocialPosts` below;
 *   3. Zernio's request-level idempotency, via a STABLE `x-request-id` derived
 *      from the post id and the exact targets+text being sent — a retry inside
 *      its 5-minute window returns the original post rather than creating one;
 *   4. its content-hash check (24h, HTTP 409), which we treat as success.
 * The request id changes if the content or targets change, so a genuine
 * edit-then-resend is never mistaken for a retry.
 */

/** Storage keys → media Zernio can attach, uploaded once and reused per network. */
type MediaUploader = (keys: string[]) => Promise<ZernioMediaItem[]>;

function mediaTypeFor(key: string): ZernioMediaItem["type"] {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  if (ext === "pdf") return "document";
  return "image";
}

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo", pdf: "application/pdf",
  };
  return map[ext] ?? "application/octet-stream";
}

function makeUploader(): MediaUploader {
  // Cache by storage key: an image shared by three networks uploads once.
  const cache = new Map<string, ZernioMediaItem | null>();
  return async (keys) => {
    const out: ZernioMediaItem[] = [];
    for (const key of keys) {
      if (!cache.has(key)) {
        const buf = await storage.get(key);
        cache.set(
          key,
          buf
            ? {
                url: await uploadZernioMedia({
                  bytes: new Uint8Array(buf),
                  filename: key.split("/").pop() || "media",
                  contentType: contentTypeFor(key),
                }),
                type: mediaTypeFor(key),
              }
            : null,
        );
      }
      const item = cache.get(key);
      if (item) out.push(item);
    }
    return out;
  };
}

export async function publishSocialPost(postId: string): Promise<void> {
  const post = await db.socialPost.findUnique({ where: { id: postId }, include: { targets: true } });
  if (!post) return;

  const pending = post.targets.filter((t) => t.status !== "posted");
  if (pending.length === 0) return;

  await db.socialPost.update({ where: { id: post.id }, data: { status: "publishing" } });

  try {
    if (!(await zernioConfigured())) throw new Error("Zernio is not configured");

    const upload = makeUploader();
    const baseKeys = readJson<string[]>(post.mediaKeys, []);
    const baseMedia = baseKeys.length ? await upload(baseKeys) : [];

    // One platform entry per pending target, tagging links PER NETWORK so GA4
    // can tell the sources apart. Tagging happens here, at send, so the stored
    // text stays the author's and re-editing can't accumulate params.
    const specs: ZernioPostTargetSpec[] = [];
    for (const t of pending) {
      const text = await tagLinksForNetwork(t.text ?? post.text, post.workspaceId, t.provider);
      const ownKeys = t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : null;
      specs.push({
        platform: t.provider.toLowerCase(),
        accountId: t.accountId,
        // Only send an override when it differs; otherwise let the base apply.
        ...(text !== post.text ? { content: text } : {}),
        ...(ownKeys?.length ? { customMedia: await upload(ownKeys) } : {}),
      });
    }

    const requestId = createHash("sha256")
      .update(JSON.stringify({ id: post.id, text: post.text, specs }))
      .digest("hex")
      .slice(0, 40);

    const result = await createZernioPost({
      content: post.text,
      platforms: specs,
      mediaItems: baseMedia,
      publishNow: true,
      requestId,
    });

    // Match Zernio's per-platform report back onto our targets. Fall back to
    // platform alone when accountId is absent from the reply.
    const byAccount = new Map(result.perPlatform.filter((p) => p.accountId).map((p) => [p.accountId!, p]));
    const byPlatform = new Map(result.perPlatform.map((p) => [p.platform, p]));

    for (const t of pending) {
      const leg = byAccount.get(t.accountId) ?? byPlatform.get(t.provider.toLowerCase());
      // A deduped 409/200 carries no per-platform detail, but it means the
      // content IS out — recording it as failed would be a lie.
      const posted = result.deduped || !leg || leg.status === "published" || leg.status === "publishing";
      await db.socialPostTarget.update({
        where: { id: t.id },
        data: posted
          ? {
              status: "posted",
              providerPostId: result.postId,
              platformPostUrl: leg?.url ?? null,
              postedAt: new Date(),
              error: null,
            }
          : { status: "failed", error: (leg?.error ?? `Zernio reported status “${leg?.status}”`).slice(0, 500) },
      });
    }
  } catch (e) {
    // The whole call failed, so every pending leg failed with it.
    await db.socialPostTarget.updateMany({
      where: { id: { in: pending.map((t) => t.id) } },
      data: { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
    });
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
