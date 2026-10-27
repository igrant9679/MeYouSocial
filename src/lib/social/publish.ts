import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { pausedWorkspaceIds } from "@/lib/governance";
import { storage } from "@/lib/storage";
import { readJson } from "@/lib/db/json";
import { tagLinksForNetwork } from "@/lib/social/utm";
import { buildPlatformData, readTargetOptions, splitLinks, supportsFirstComment } from "@/lib/social/platform-options";
import { normaliseWatermark, watermarkerFor } from "@/lib/social/watermark";
import {
  createZernioPost,
  getZernioPost,
  uploadZernioMedia,
  zernioConfigured,
  type ZernioMediaItem,
  type ZernioPostTargetSpec,
} from "@/lib/zernio";
import { MAY_HAVE_POSTED } from "@/lib/social/unknown-outcome";
import { legProblem } from "@/lib/social/validate";

/** Every leg was refused before sending — not an error to record on them again. */
class NothingToSend extends Error {}

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

type Watermarker = ((bytes: Uint8Array, contentType: string) => Promise<Uint8Array>) | null;

function makeUploader(workspaceId: string, watermark: Watermarker = null): MediaUploader {
  // Cache by storage key: an image shared by three networks uploads once.
  const cache = new Map<string, ZernioMediaItem | null>();
  return async (keys) => {
    const out: ZernioMediaItem[] = [];
    for (const key of keys) {
      if (!cache.has(key)) {
        // ⚠ An image that can't be read stops the send (SOC-09). A Drive 401,
        // 429 or timeout used to come back as "no bytes", and the post went out
        // text-only with every leg marked posted. Throwing here fails the legs
        // BEFORE anything reaches a network, with the reason, and Retry works.
        const buf = await storage.get(key).catch(() => null);
        if (!buf) {
          throw new Error(`Couldn't read the image ${key.split("/").pop() ?? key} from storage (the storage service didn't answer or the file is gone), so nothing was sent. Retry in a few minutes, or remove the image.`);
        }
        const raw = new Uint8Array(buf);
        const contentType = sniffContentType(raw) ?? contentTypeFor(key);
        if (!contentType || !PRESIGN_ALLOWED.has(contentType)) {
          // Say it here, naming the file, rather than letting presign 400
          // with a message about a type nobody chose.
          throw new Error(
            `Can't upload ${key}: its file type ${contentType ? `(${contentType}) ` : ""}isn't one Zernio accepts. Attach a JPEG, PNG, WebP, GIF, MP4, MOV, WebM or PDF.`,
          );
        }
        let bytes = await stripImageMetadata(raw, contentType);
        // The logo goes on the UPLOADED copy only — the stored original
        // stays clean, so a re-send without a watermark just works.
        if (watermark) bytes = await watermark(bytes, contentType);
        let filename = key.split("/").pop() || "media";
        if (!filename.includes(".") && EXT_FOR[contentType]) filename += `.${EXT_FOR[contentType]}`;
        cache.set(key, {
          url: await uploadZernioMedia({ bytes, filename, contentType, workspaceId }),
          type: mediaTypeFor(key, contentType),
        });
      }
      const item = cache.get(key);
      if (item) out.push(item);
    }
    return out;
  };
}

/**
 * Send one post to its networks. `claimed` is true only for the scheduler,
 * which has already moved the row scheduled → publishing. Every other caller
 * (Post now, Retry, the assistant) gets the same atomic claim here, so two of
 * them — or one of them and the sweep — can no longer send the same post
 * twice. Returns quietly when someone else holds the claim or it's already out.
 */
export async function publishSocialPost(postId: string, opts: { claimed?: boolean } = {}): Promise<void> {
  const post = await db.socialPost.findUnique({
    where: { id: postId },
    include: { targets: true, campaign: { select: { utmCampaign: true } } },
  });
  if (!post) return;

  // No accounts: there is nowhere to send it. Before, a post with no targets
  // (RSS drafts, for one) was scheduled, claimed, and left in "publishing"
  // for good. Put it back in drafts where someone can pick accounts.
  if (post.targets.length === 0) {
    if (post.status !== "draft") {
      await db.socialPost.update({ where: { id: post.id }, data: { status: "draft", scheduledAt: null } });
    }
    return;
  }

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

  if (!opts.claimed) {
    // The claim for direct sends (the sweep claims before calling). Only one
    // caller moves an unsent post into "publishing"; anyone else stops here.
    const claim = await db.socialPost.updateMany({
      where: { id: post.id, status: { in: ["draft", "scheduled", "failed", "partial"] } },
      data: { status: "publishing" },
    });
    if (claim.count !== 1) return;
  }

  // Legs refused before sending, with the reason each would have failed for.
  const refused = new Map<string, string>();
  try {
    if (!(await zernioConfigured(post.workspaceId))) throw new Error("Zernio is not configured");

    const upload = makeUploader(post.workspaceId, await watermarkerFor(post.workspaceId, normaliseWatermark(post.watermark)));
    const baseKeys = readJson<string[]>(post.mediaKeys, []);

    // One platform entry per pending target, tagging links PER NETWORK so GA4
    // can tell the sources apart. Tagging happens here, at send, so the stored
    // text stays the author's and re-editing can't accumulate params.
    const specs: ZernioPostTargetSpec[] = [];
    // What the request id is made of: the same legs with STORAGE KEYS where
    // the specs carry upload URLs. Every attempt uploads afresh and gets new
    // URLs, so an id over the specs changed on every retry and Zernio's
    // duplicate guard never matched one (audit SOC-12).
    const fingerprint: unknown[] = [];
    for (const t of pending) {
      let text = await tagLinksForNetwork(
        t.text ?? post.text, post.workspaceId, t.provider, post.campaign?.utmCampaign,
      );
      const ownKeys = t.mediaKeys ? readJson<string[]>(t.mediaKeys, []) : null;
      // First comment: the target's own, else the post's — tagged per network
      // like the caption. "Move link to first comment" runs AFTER tagging, so
      // a moved link keeps its UTM, and only where a first comment exists
      // (never a Story, never X or TikTok); elsewhere the link stays put.
      const ownComment = (t.firstComment ?? post.firstComment ?? "").trim();
      let firstComment = ownComment
        ? await tagLinksForNetwork(ownComment, post.workspaceId, t.provider, post.campaign?.utmCampaign)
        : null;
      if (post.linkToFirstComment && supportsFirstComment(t.provider, t.subFormat)) {
        const { caption, links } = splitLinks(text);
        if (links.length && caption) {
          text = caption;
          firstComment = [links.join("\n"), firstComment].filter(Boolean).join("\n\n");
        }
      }
      // A leg its network is certain to reject (no video for YouTube, no image
      // for Instagram, no TikTok audience, past the length limit with links
      // tagged) fails here with the reason; the other legs still go (SOC-13/14).
      const problem = legProblem(t, post, text);
      if (problem) {
        refused.set(t.id, problem);
        continue;
      }
      const effectiveKeys = ownKeys?.length ? ownKeys : baseKeys;
      const isVideo = effectiveKeys.length > 0 && effectiveKeys.every((k) => (contentTypeFor(k) ?? "").startsWith("video/"));
      // Story/Reel, first comment, TikTok settings — one documented builder.
      // Null when the network's defaults are wanted (a plain feed post).
      const platformSpecificData = buildPlatformData({
        provider: t.provider,
        subFormat: t.subFormat,
        firstComment,
        options: readTargetOptions(t.options),
        isVideo,
      });
      specs.push({
        platform: t.provider.toLowerCase(),
        accountId: t.accountId,
        // Only send an override when it differs; otherwise let the base apply.
        ...(text !== post.text ? { content: text } : {}),
        ...(ownKeys?.length ? { customMedia: await upload(ownKeys) } : {}),
        ...(platformSpecificData ? { platformSpecificData } : {}),
      });
      fingerprint.push([t.provider.toLowerCase(), t.accountId, text, ownKeys ?? null, platformSpecificData ?? null]);
    }

    for (const [id, reason] of refused) {
      await db.socialPostTarget.update({ where: { id }, data: { status: "failed", error: reason.slice(0, 500) } });
    }
    // Nothing left that could succeed: don't call Zernio at all — not even to
    // upload the images, which is why that waits until now.
    if (specs.length === 0) throw new NothingToSend();
    const baseMedia = baseKeys.length ? await upload(baseKeys) : [];

    const requestId = createHash("sha256")
      .update(JSON.stringify({ id: post.id, text: post.text, media: baseKeys, legs: fingerprint }))
      .digest("hex")
      .slice(0, 40);

    // The workspace's Zernio profile scopes the accounts — without it Zernio
    // resolves the key's default profile and refuses other profiles' accounts.
    const ws = await db.workspace.findUnique({
      where: { id: post.workspaceId },
      select: { zernioProfileId: true },
    });

    // From here the request may reach Zernio. A timeout or abort after this
    // point is NOT a failure we know of: the post may be live (CF, 23 Oct —
    // three legs "aborted due to timeout" and offered for Retry).
    let result: Awaited<ReturnType<typeof createZernioPost>>;
    try {
      result = await createZernioPost({
        content: post.text,
        platforms: specs,
        mediaItems: baseMedia,
        publishNow: true,
        requestId,
        profileId: ws?.zernioProfileId ?? undefined,
        workspaceId: post.workspaceId,
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`No answer from Zernio in time — this ${MAY_HAVE_POSTED}. Check the network before retrying.`);
      }
      throw e;
    }

    // Match Zernio's per-platform report back onto our targets. Fall back to
    // platform alone when accountId is absent from the reply.
    const byAccount = new Map(result.perPlatform.filter((p) => p.accountId).map((p) => [p.accountId!, p]));
    const byPlatform = new Map(result.perPlatform.map((p) => [p.platform, p]));

    for (const t of pending) {
      if (refused.has(t.id)) continue;
      const leg = byAccount.get(t.accountId) ?? byPlatform.get(t.provider.toLowerCase());
      // A 409 (content-hash duplicate) carries no per-platform detail, but it
      // means the content IS out — recording it as failed would be a lie.
      // ⚠ A 200 replay of an earlier request DOES carry the legs, and each
      // keeps its own outcome: marking every leg of a replay posted turned a
      // leg that had failed into "posted" (audit SOC-12).
      const posted = leg ? leg.status === "published" || leg.status === "publishing" : result.deduped;
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
    // The whole call failed, so every leg we tried to send failed with it. The
    // refused ones already carry their own reason.
    if (!(e instanceof NothingToSend)) {
      await db.socialPostTarget.updateMany({
        where: { id: { in: pending.filter((t) => !refused.has(t.id)).map((t) => t.id) } },
        data: { status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) },
      });
    }
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
  // ⚠ The global pause is the emergency brake; scheduled sends used to ignore
  // it entirely. (notIn is safe here: workspaceId is never NULL.)
  const paused = await pausedWorkspaceIds();
  const due = await db.socialPost.findMany({
    // ⚠ The approval filter is spelled as an OR over the two sendable values,
    // NOT `notIn: ["pending","changes"]` — SQL's NOT IN excludes NULL rows,
    // which would silently stop every normal (approval = null) post from ever
    // publishing. `approval` only ever holds null|pending|approved|changes.
    where: {
      workspaceId: { notIn: paused },
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
      await publishSocialPost(id, { claimed: true });
      published++;
    } catch {
      await db.socialPost.updateMany({ where: { id, status: "publishing" }, data: { status: "failed" } });
    }
  }
  return published;
}

const STUCK_AFTER_MS = 15 * 60_000;
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
const SETTLED_POSTED = new Set(["published"]);
const SETTLED_FAILED = new Set(["failed", "error", "cancelled", "rejected"]);

/**
 * Settle posts stuck in "publishing" (audit SOC-11). A container killed
 * mid-send, or a leg Zernio accepted and never reported on, left "Publishing
 * now" for good — and the only way out was a re-send.
 *
 * Nothing here sends. After 15 quiet minutes:
 *   · a leg Zernio knows about (it has our providerPostId) takes the status
 *     Zernio reports for it now — published or failed; still in flight, it
 *     waits (and after a day it's settled as unknown, said in those words);
 *   · a leg with no Zernio id was interrupted before we heard back, so it may
 *     or may not be live — failed, with the warning Retry shows.
 * Then the post rolls up from its legs, as after a send.
 */
export async function reconcileStuckSocialPosts(): Promise<number> {
  const now = Date.now();
  const stuck = await db.socialPost.findMany({
    where: { status: "publishing", updatedAt: { lt: new Date(now - STUCK_AFTER_MS) } },
    include: { targets: true },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });
  let settled = 0;
  for (const post of stuck) {
    const open = post.targets.filter((t) => t.status === "pending");
    const stale = now - post.updatedAt.getTime() > GIVE_UP_AFTER_MS;
    const byZernioPost = new Map<string, typeof open>();
    for (const t of open) {
      if (!t.providerPostId) {
        await db.socialPostTarget.updateMany({
          where: { id: t.id, status: "pending" },
          data: { status: "failed", error: `The send was interrupted before Zernio answered — this ${MAY_HAVE_POSTED}. Check the network before retrying.` },
        });
        continue;
      }
      byZernioPost.set(t.providerPostId, [...(byZernioPost.get(t.providerPostId) ?? []), t]);
    }
    for (const [zernioPostId, legs] of byZernioPost) {
      const remote = await getZernioPost(zernioPostId, post.workspaceId).catch(() => null);
      const byAccount = new Map((remote?.perPlatform ?? []).filter((p) => p.accountId).map((p) => [p.accountId!, p]));
      const byPlatform = new Map((remote?.perPlatform ?? []).map((p) => [p.platform, p]));
      for (const t of legs) {
        const leg = byAccount.get(t.accountId) ?? byPlatform.get(t.provider.toLowerCase());
        if (leg && SETTLED_POSTED.has(leg.status)) {
          await db.socialPostTarget.updateMany({
            where: { id: t.id, status: "pending" },
            data: { status: "posted", postedAt: new Date(), error: null, ...(leg.url ? { platformPostUrl: leg.url } : {}) },
          });
        } else if (leg && SETTLED_FAILED.has(leg.status)) {
          await db.socialPostTarget.updateMany({
            where: { id: t.id, status: "pending" },
            data: { status: "failed", error: (leg.error ?? `Zernio reports this ${leg.status}.`).slice(0, 500) },
          });
        } else if (stale) {
          await db.socialPostTarget.updateMany({
            where: { id: t.id, status: "pending" },
            data: { status: "failed", error: `Zernio hasn't reported on this account in a day — status unknown; this ${MAY_HAVE_POSTED}. Check the network before retrying.` },
          });
        }
      }
    }
    // Roll up from the legs, exactly as a send does. A leg still in flight
    // keeps the post "publishing" for the next pass.
    const fresh = await db.socialPostTarget.findMany({ where: { postId: post.id }, select: { status: true } });
    if (fresh.length === 0) continue;
    const posted = fresh.filter((t) => t.status === "posted").length;
    const stillPending = fresh.some((t) => t.status === "pending");
    const status = posted === fresh.length ? "posted" : posted > 0 ? "partial" : stillPending ? "publishing" : "failed";
    if (status === "publishing") continue;
    const moved = await db.socialPost.updateMany({
      where: { id: post.id, status: "publishing" },
      data: { status, publishedAt: posted > 0 ? post.publishedAt ?? new Date() : null },
    });
    settled += moved.count;
  }
  return settled;
}

/**
 * Settle every leg of one Zernio post from Zernio's own record (GET only —
 * nothing is sent). For webhook events that don't say which leg they mean,
 * like `post.partial` (audit SOC-15): reading the post beats guessing from
 * the event's name. A leg already posted is never moved back; a leg Zernio
 * still reports in flight is left alone. Returns how many legs changed.
 */
export async function settleLegsFromZernio(zernioPostId: string, workspaceId: string): Promise<number> {
  const legs = await db.socialPostTarget.findMany({
    where: { providerPostId: zernioPostId, status: { not: "posted" }, post: { workspaceId } },
    select: { id: true, accountId: true, provider: true },
  });
  if (!legs.length) return 0;
  const remote = await getZernioPost(zernioPostId, workspaceId).catch(() => null);
  if (!remote) return 0;
  const byAccount = new Map(remote.perPlatform.filter((p) => p.accountId).map((p) => [p.accountId!, p]));
  const byPlatform = new Map(remote.perPlatform.map((p) => [p.platform, p]));
  let changed = 0;
  for (const t of legs) {
    const leg = byAccount.get(t.accountId) ?? byPlatform.get(t.provider.toLowerCase());
    if (leg && SETTLED_POSTED.has(leg.status)) {
      changed += (await db.socialPostTarget.updateMany({
        where: { id: t.id, status: { not: "posted" } },
        data: { status: "posted", postedAt: new Date(), error: null, ...(leg.url ? { platformPostUrl: leg.url } : {}) },
      })).count;
    } else if (leg && SETTLED_FAILED.has(leg.status)) {
      changed += (await db.socialPostTarget.updateMany({
        where: { id: t.id, status: { not: "posted" } },
        data: { status: "failed", error: (leg.error ?? `Zernio reports this ${leg.status}.`).slice(0, 500) },
      })).count;
    }
  }
  return changed;
}
