import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { readJson } from "@/lib/db/json";
import { tagLinksForNetwork } from "@/lib/social/utm";
import { platformDataFor } from "@/lib/social/sub-formats";
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

function mediaTypeFor(key: string, contentType?: string | null): ZernioMediaItem["type"] {
  if (contentType?.startsWith("video/")) return "video";
  if (contentType === "application/pdf") return "document";
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "avi", "webm"].includes(ext)) return "video";
  if (ext === "pdf") return "document";
  return "image";
}

/**
 * ⚠ Trust the BYTES, not the key. Drive-stored media keys are extensionless
 * (`gdrive:<fileId>`), so an extension map alone returns
 * application/octet-stream — which Zernio's presign started REJECTING against
 * a content-type allowlist on 2026-08-05, failing every scheduled send of an
 * auto-generated image (the 08-04 manual send predated the validation). Same
 * rule as the images layer: dimensions/types come from the bytes.
 */
function sniffContentType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4"; // ISO-BMFF "ftyp"
  // WebM/Matroska (EBML) and AVI (RIFF….AVI ) have no ftyp box, so without
  // these two an extensionless Drive-stored video sniffed to nothing.
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x41 && b[9] === 0x56 && b[10] === 0x49) return "video/x-msvideo";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

/**
 * Zernio's presign takes a fixed allowlist of MIME types (documented at
 * docs.zernio.com/media/get-media-presigned-url). `application/octet-stream` is
 * NOT on it — sending one is the 400 that broke every scheduled send on
 * 2026-08-05. Everything this map and `sniffContentType` can produce IS on it.
 */
const PRESIGN_ALLOWED = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/mpeg", "video/quicktime", "video/avi", "video/x-msvideo",
  "video/webm", "video/x-m4v", "application/pdf",
]);

function contentTypeFor(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo",
    mpeg: "video/mpeg", m4v: "video/x-m4v", pdf: "application/pdf",
  };
  // ⚠ null, never "application/octet-stream". Drive keys are extensionless, so
  // an unsniffable video (webm and avi have no ftyp box) used to fall through
  // to octet-stream and be rejected by presign — a 400 at SEND time, hours
  // after anyone could act on it. Failing here names the file instead.
  return map[ext] ?? null;
}

/** File extension for a content type, so extensionless keys upload with an honest filename. */
const EXT_FOR: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "application/pdf": "pdf",
};

/**
 * Re-encode image pixels at publish time, dropping embedded metadata
 * (EXIF/XMP/C2PA content credentials). gpt-image-1 stamps C2PA provenance
 * into every PNG, and Facebook auto-labels any image carrying that signal as
 * "AI info" — reported from the field 2026-08-07 on every published MYS post.
 * Re-encoding is presentation, not deception: the stored ORIGINAL keeps its
 * credentials, our audit rows name the generating provider, and Google's
 * SynthID lives in the pixels so Gemini images may still be detected.
 * `rotate()` bakes EXIF orientation into the pixels before EXIF is dropped,
 * so phone photos don't come out sideways. Any failure uploads the original
 * bytes — a metadata nicety must never block a send.
 */
async function stripImageMetadata(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(contentType)) return bytes;
  try {
    const sharp = (await import("sharp")).default;
    // No explicit format: sharp keeps the input format, so contentType stays true.
    const out = await sharp(Buffer.from(bytes)).rotate().toBuffer();
    return new Uint8Array(out);
  } catch (e) {
    console.warn("[social] metadata strip failed — uploading original bytes:", e instanceof Error ? e.message : e);
    return bytes;
  }
}

function makeUploader(workspaceId: string): MediaUploader {
  // Cache by storage key: an image shared by three networks uploads once.
  const cache = new Map<string, ZernioMediaItem | null>();
  return async (keys) => {
    const out: ZernioMediaItem[] = [];
    for (const key of keys) {
      if (!cache.has(key)) {
        const buf = await storage.get(key);
        if (buf) {
          const raw = new Uint8Array(buf);
          const contentType = sniffContentType(raw) ?? contentTypeFor(key);
          if (!contentType || !PRESIGN_ALLOWED.has(contentType)) {
            // Say it here, naming the file, rather than letting presign 400
            // with a message about a type nobody chose.
            throw new Error(
              `Can't upload ${key}: its file type ${contentType ? `(${contentType}) ` : ""}isn't one Zernio accepts. Attach a JPEG, PNG, WebP, GIF, MP4, MOV, WebM or PDF.`,
            );
          }
          const bytes = await stripImageMetadata(raw, contentType);
          let filename = key.split("/").pop() || "media";
          if (!filename.includes(".") && EXT_FOR[contentType]) filename += `.${EXT_FOR[contentType]}`;
          cache.set(key, {
            url: await uploadZernioMedia({ bytes, filename, contentType, workspaceId }),
            type: mediaTypeFor(key, contentType),
          });
        } else {
          cache.set(key, null);
        }
      }
      const item = cache.get(key);
      if (item) out.push(item);
    }
    return out;
  };
}

export async function publishSocialPost(postId: string): Promise<void> {
  const post = await db.socialPost.findUnique({
    where: { id: postId },
    include: { targets: true, campaign: { select: { utmCampaign: true } } },
  });
  if (!post) return;

  // ⚠ Unapproved content must never reach a network, whoever calls this and
  // however the post got here. The sweep's claim already excludes these; this
  // guard covers the direct paths (Post now, retry) and anything future. The
  // post drops back to draft — leaving it "scheduled" would make the sweep
  // retry a post it can never send.
  if (post.approval === "pending" || post.approval === "changes") {
    if (post.status !== "draft") {
      await db.socialPost.update({ where: { id: post.id }, data: { status: "draft" } });
    }
    return;
  }

  const pending = post.targets.filter((t) => t.status !== "posted");
  if (pending.length === 0) {
    // Nothing left to send. Returning bare would strand a post the scheduler
    // had already claimed (scheduled → publishing) in "publishing" for good, so
    // settle it here instead. Only when there ARE targets and they're all out —
    // a post with none was never sent anywhere and mustn't be called posted.
    if (post.targets.length > 0 && post.status !== "posted") {
      await db.socialPost.update({
        where: { id: post.id },
        data: { status: "posted", publishedAt: post.publishedAt ?? new Date() },
      });
    }
    return;
  }

  await db.socialPost.update({ where: { id: post.id }, data: { status: "publishing" } });

  try {
    if (!(await zernioConfigured(post.workspaceId))) throw new Error("Zernio is not configured");

    const upload = makeUploader(post.workspaceId);
    const baseKeys = readJson<string[]>(post.mediaKeys, []);
    const baseMedia = baseKeys.length ? await upload(baseKeys) : [];

    // One platform entry per pending target, tagging links PER NETWORK so GA4
    // can tell the sources apart. Tagging happens here, at send, so the stored
    // text stays the author's and re-editing can't accumulate params.
    const specs: ZernioPostTargetSpec[] = [];
    for (const t of pending) {
      const text = await tagLinksForNetwork(
        t.text ?? post.text, post.workspaceId, t.provider, post.campaign?.utmCampaign,
      );
      const ownKeys = t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : null;
      // Story/Reel rather than a feed post, where the network takes a choice.
      // Null for everything else, which is how YouTube and TikTok keep working:
      // they infer the format from the media and take no field at all.
      const platformSpecificData = platformDataFor(t.provider, t.subFormat);
      specs.push({
        platform: t.provider.toLowerCase(),
        accountId: t.accountId,
        // Only send an override when it differs; otherwise let the base apply.
        ...(text !== post.text ? { content: text } : {}),
        ...(ownKeys?.length ? { customMedia: await upload(ownKeys) } : {}),
        ...(platformSpecificData ? { platformSpecificData } : {}),
      });
    }

    const requestId = createHash("sha256")
      .update(JSON.stringify({ id: post.id, text: post.text, specs }))
      .digest("hex")
      .slice(0, 40);

    // The workspace's Zernio profile scopes the accounts — without it Zernio
    // resolves the key's default profile and refuses other profiles' accounts.
    const ws = await db.workspace.findUnique({
      where: { id: post.workspaceId },
      select: { zernioProfileId: true },
    });

    const result = await createZernioPost({
      content: post.text,
      platforms: specs,
      mediaItems: baseMedia,
      publishNow: true,
      requestId,
      profileId: ws?.zernioProfileId ?? undefined,
      workspaceId: post.workspaceId,
    });

    // Match Zernio's per-platform report back onto our targets. Fall back to
    // platform alone when accountId is absent from the reply.
    const byAccount = new Map(result.perPlatform.filter((p) => p.accountId).map((p) => [p.accountId!, p]));
    const byPlatform = new Map(result.perPlatform.map((p) => [p.platform, p]));

    for (const t of pending) {
      const leg = byAccount.get(t.accountId) ?? byPlatform.get(t.provider.toLowerCase());
      // A deduped 409/200 carries no per-platform detail, but it means the
      // content IS out — recording it as failed would be a lie.
      const posted = result.deduped || leg?.status === "published" || leg?.status === "publishing";
      // ⚠ A MISSING leg is not a success. Zernio accepting the request says
      // nothing about a platform it then didn't report on, and marking that
      // "posted" with a postedAt invents an outcome we were never told — the
      // one thing this codebase doesn't do. Leave it pending, keep the post id
      // so `post.published` can still reconcile it, and say why. The roll-up
      // below turns that into "partial", which is the honest reading.
      const unreported = !result.deduped && !leg;
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
          : unreported
            ? {
                status: "pending",
                providerPostId: result.postId,
                error: "Zernio accepted the post but reported nothing for this account — status unknown.",
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

  // Roll up the post status from its targets. A target left PENDING is still in
  // flight, not a failure: if nothing posted but nothing failed either, the post
  // stays "publishing" so the webhook can settle it, rather than being written
  // off as failed on no evidence.
  const fresh = await db.socialPostTarget.findMany({ where: { postId: post.id } });
  const posted = fresh.filter((t) => t.status === "posted").length;
  const stillPending = fresh.some((t) => t.status === "pending");
  const status =
    posted === fresh.length ? "posted" : posted > 0 ? "partial" : stillPending ? "publishing" : "failed";
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
    // ⚠ The approval filter is spelled as an OR over the two sendable values,
    // NOT `notIn: ["pending","changes"]` — SQL's NOT IN excludes NULL rows,
    // which would silently stop every normal (approval = null) post from ever
    // publishing. `approval` only ever holds null|pending|approved|changes.
    where: {
      status: "scheduled",
      scheduledAt: { lte: new Date() },
      OR: [{ approval: null }, { approval: "approved" }],
    },
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
