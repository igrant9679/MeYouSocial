import { networkFor } from "@/lib/social/networks";
import { readJson } from "@/lib/db/json";

/**
 * Instagram and Pinterest for the posts the app writes itself (2026-11-23, the owner's "Yes, build it").
 *
 * They need a picture, and a post the app writes starts with none, so the writers used to leave them out entirely —
 * LSI's Instagram and Pinterest never got an engine post or an article share, though the auto-image job attaches a
 * picture a minute later. Now:
 *   1. the writers include these networks when a picture IS coming (`pictureWillCome`: auto-image on and a real image
 *      provider — the job never attaches the mock's picture);
 *   2. the minute sweep holds a due post while its picture is still being made (`awaitingPicture`), up to
 *      PICTURE_HOLD_MS past its time;
 *   3. a picture that never comes leaves those networks failing at the send with the usual reason ("Instagram needs
 *      an image…") while the other networks still go out — the existing rule (SOC-13/14), told like any failed send.
 *
 * YouTube (a video) and Snapchat stay out: the job makes a still image. TikTok stays out too: it needs a PERSON's
 * deliberate choice of who can see the post (tiktokRefusal) — there is no default the engine may pick.
 */

/** Networks that need a picture and take the square still the auto-image job makes. */
export const PICTURE_NETWORKS: ReadonlySet<string> = new Set(["instagram", "pinterest"]);

/** A connected network that needs a picture and can take the app's: Instagram, Pinterest. */
export function takesAppPicture(platform: string): boolean {
  const n = networkFor(platform);
  return Boolean(n?.requiresMedia && !n.requiresVideo && PICTURE_NETWORKS.has(n.provider));
}

/**
 * The accounts a post the app writes goes to: every one that takes text alone, plus the picture networks when a
 * picture is coming. Video-only networks never.
 */
export function engineTargets<T extends { platform: string }>(accounts: readonly T[], pictureComing: boolean): T[] {
  return accounts.filter((a) => {
    const n = networkFor(a.platform);
    if (!n?.requiresMedia) return true;
    return pictureComing && takesAppPicture(a.platform);
  });
}

/** Will the auto-image job attach a real picture to a post written now? Auto-image on, and a real provider. */
export async function pictureWillCome(workspaceId: string): Promise<boolean> {
  const { getSetting } = await import("@/lib/settings");
  if ((await getSetting("social:auto_image", workspaceId).catch(() => "")) === "false") return false;
  const { getImageProvider } = await import("@/lib/images");
  return (await getImageProvider(workspaceId).catch(() => null))?.name !== "mock";
}

/** How long past its time a due post waits for its picture before it goes without one. */
export const PICTURE_HOLD_MS = 15 * 60_000;

/**
 * Does this due post wait for its picture? Yes when it has no picture, an unsent leg on a picture network without one
 * of its own, it's within PICTURE_HOLD_MS of its time, and its auto-image job is still queued or running
 * (`imageJobLive`). Pure, so the sweep and a test read the same rule.
 */
export function awaitingPicture(
  post: { mediaKeys: string; scheduledAt: Date | null; targets: Array<{ provider: string; status: string; mediaKeys: string | null }> },
  imageJobLive: boolean,
  now: Date,
): boolean {
  if (!imageJobLive) return false;
  if (readJson<string[]>(post.mediaKeys, []).length > 0) return false;
  if (post.scheduledAt && now.getTime() - post.scheduledAt.getTime() > PICTURE_HOLD_MS) return false;
  return post.targets.some(
    (t) => t.status !== "posted" && takesAppPicture(t.provider) && readJson<string[]>(t.mediaKeys ?? "[]", []).length === 0,
  );
}
