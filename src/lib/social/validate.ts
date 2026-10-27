import { db } from "@/lib/db";
import { readJson } from "@/lib/db/json";
import { networkFor } from "@/lib/social/networks";
import { subFormatsFor } from "@/lib/social/sub-formats";
import { readTargetOptions, tiktokRefusal } from "@/lib/social/platform-options";

/**
 * One set of network rules for every path that schedules or sends a post
 * (SOC-13, SOC-14). They used to live only in the composer, so Post now, the
 * calendar drag, Queue, bulk queue, approval, the assistant and full autonomy
 * all scheduled posts a network was certain to reject — and the leg failed
 * hours later at send. The send itself checks too (lib/social/publish.ts),
 * so nothing that can't succeed is ever handed to Zernio.
 *
 * Only certainties: a network that needs an image or a video and has none, a
 * Story/Reel without the media it requires, TikTok with no audience chosen
 * (TikTok forbids a default), and text past the network's own limit.
 */

export type LegInput = {
  provider: string;
  /** The leg's own text, else the post's. */
  text: string | null;
  /** The leg's own media, else the post's. */
  mediaKeys: string | null;
  subFormat: string | null;
  options: string | null;
};

export type LegProblem = { provider: string; label: string; reason: string };

const VIDEO_EXT = /\.(mp4|mov|webm|avi|mpeg|m4v)$/i;

/** Why this leg can't go out, or null. `text` is what will be sent (tagged links included at send). */
export function legProblem(leg: LegInput, post: { text: string; mediaKeys: string | null }, sendText?: string): string | null {
  const net = networkFor(leg.provider);
  const label = net?.label ?? leg.provider;
  const own = leg.mediaKeys ? readJson<string[]>(leg.mediaKeys, []) : [];
  const media = own.length ? own : readJson<string[]>(post.mediaKeys, []);
  const hasVideo = media.some((k) => VIDEO_EXT.test(k));
  const sub = leg.subFormat ? subFormatsFor(leg.provider).find((o) => o.value === leg.subFormat) : undefined;

  if (net?.requiresVideo && !hasVideo) {
    return `${label} takes a video, and this post has none — the app can only attach images today, so deselect ${label}.`;
  }
  if (sub?.requiresVideo && !hasVideo) {
    return `A ${label} ${sub.label} needs a video, and this post has none — publish it as a feed post instead.`;
  }
  if ((net?.requiresMedia || sub?.requiresMedia) && media.length === 0) {
    return `${label}${sub ? ` ${sub.label}` : ""} needs an image — attach one, or deselect ${label}.`;
  }
  if (leg.provider.toLowerCase() === "tiktok") {
    const refusal = tiktokRefusal(readTargetOptions(leg.options).tiktok);
    if (refusal) return refusal;
  }
  const text = sendText ?? leg.text ?? post.text;
  if (net && text.length > net.charLimit) {
    return `Too long for ${label}: ${text.length} characters, the limit is ${net.charLimit}. Shorten it or customize the ${label} text.`;
  }
  return null;
}

/** Every leg's problem, for a post as stored. */
export async function postProblems(postId: string): Promise<LegProblem[]> {
  const post = await db.socialPost.findUnique({
    where: { id: postId },
    select: { text: true, mediaKeys: true, targets: { select: { provider: true, text: true, mediaKeys: true, subFormat: true, options: true, status: true } } },
  });
  if (!post) return [];
  const out: LegProblem[] = [];
  for (const t of post.targets) {
    if (t.status === "posted") continue;
    const reason = legProblem(t, post);
    if (reason) out.push({ provider: t.provider, label: networkFor(t.provider)?.label ?? t.provider, reason });
  }
  return out;
}

/** One sentence for a person scheduling the post, or null when it can go. */
export async function scheduleRefusal(postId: string): Promise<string | null> {
  const problems = await postProblems(postId);
  if (!problems.length) return null;
  return problems.length === 1 ? problems[0].reason : `${problems.length} networks would reject it: ${problems.map((p) => p.reason).join(" ")}`;
}
