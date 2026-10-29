import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { networkFor } from "@/lib/social/networks";
import { getPostingTimeZone, parseZonedInput } from "@/lib/social/slots";
import { formatZonedMoment } from "@/lib/zoned-dates";

/**
 * What a confirm card shows (E-ENG-01): built on the SERVER from the tool and
 * its arguments, never from the model's own description of them — the post's
 * real text and networks, its time in the posting zone, the article and its
 * live URL, an image thumbnail. Built when the assistant proposes, and again
 * just before it runs: `problem` is set when the thing has gone or the time has
 * passed in between, and then nothing runs.
 */
export type ConfirmPreview = {
  /** The post's text, the article's title — what the action is about. */
  body?: string | null;
  fields: Array<{ label: string; value: string }>;
  image?: string | null;
  /** Where it lives in the app. */
  href?: string | null;
  problem?: string | null;
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const LABEL: Record<string, string> = {
  networks: "Networks", url: "URL", email: "Email", role: "Role", reason: "Reason", mode: "Mode", fn: "Function",
  on: "On", enabled: "On", day: "Day", count: "How many", timezone: "Time zone", slots: "Slots", value: "Value", key: "Setting",
};
// Arguments the card shows through the post or article it names instead.
const SHOWN_ELSEWHERE = new Set(["postId", "articleId", "at", "text"]);

function firstMedia(raw: string | null | undefined): string | null {
  try {
    const keys = JSON.parse(raw ?? "[]");
    return Array.isArray(keys) && typeof keys[0] === "string" ? storage.url(keys[0]) : null;
  } catch {
    return null;
  }
}

export async function buildPreview(tool: string, args: Record<string, unknown>, ctx: { workspaceId: string }): Promise<ConfirmPreview> {
  const tz = await getPostingTimeZone(ctx.workspaceId).catch(() => "UTC");
  const out: ConfirmPreview = { fields: [] };

  const postId = str(args.postId, 40);
  if (postId) {
    const post = await db.socialPost.findFirst({
      where: { id: postId, workspaceId: ctx.workspaceId },
      select: { id: true, text: true, status: true, scheduledAt: true, mediaKeys: true, approval: true, targets: { select: { provider: true, accountName: true } } },
    });
    if (!post) return { ...out, problem: "That post no longer exists." };
    out.body = post.text.slice(0, 600) || "(image only)";
    out.href = post.status === "draft" || post.status === "scheduled" ? `/social/${post.id}/edit` : `/social/${post.id}`;
    out.image = firstMedia(post.mediaKeys);
    out.fields.push({ label: "Networks", value: post.targets.length ? post.targets.map((t) => `${networkFor(t.provider)?.label ?? t.provider}${t.accountName ? ` (${t.accountName})` : ""}`).join(", ") : "none chosen yet" });
    out.fields.push({ label: "Now", value: post.status === "scheduled" && post.scheduledAt ? `scheduled for ${formatZonedMoment(post.scheduledAt, tz)}` : post.status });
    if (post.approval === "pending" || post.approval === "changes") out.fields.push({ label: "Review", value: post.approval === "pending" ? "awaiting approval" : "changes requested" });
    if (/^(send_social_post_now|queue_social_post|schedule_social_post)$/.test(tool) && post.status !== "draft" && post.status !== "scheduled") {
      out.problem = `It has already gone ${post.status === "publishing" ? "to the networks — it's sending now" : "out"}.`;
    }
  }

  const articleId = str(args.articleId, 40);
  if (articleId) {
    const art = await db.blogPost.findFirst({
      where: { id: articleId, workspaceId: ctx.workspaceId },
      select: { id: true, title: true, status: true, publishedUrl: true, scheduledAt: true, images: { where: { role: "featured" }, select: { url: true }, take: 1 } },
    });
    if (!art) return { ...out, problem: "That article no longer exists." };
    out.body = art.title;
    out.href = `/blog/${art.id}`;
    out.image = art.images[0]?.url ?? out.image ?? null;
    out.fields.push({ label: "Article now", value: art.status.replace(/_/g, " ") });
    if (art.publishedUrl) out.fields.push({ label: "Live at", value: art.publishedUrl });
    if (art.scheduledAt) out.fields.push({ label: "Scheduled", value: formatZonedMoment(art.scheduledAt, tz) });
  }

  if (!postId && !articleId && str(args.text, 600)) out.body = str(args.text, 600);

  const at = str(args.at, 40);
  if (at) {
    const when = parseZonedInput(at, tz) ?? (Number.isFinite(Date.parse(at)) ? new Date(at) : null);
    if (!when) out.problem = out.problem ?? `“${at}” isn't a time I can read.`;
    else {
      out.fields.push({ label: "When", value: formatZonedMoment(when, tz) });
      if (when.getTime() < Date.now() - 60_000) out.problem = out.problem ?? `${formatZonedMoment(when, tz)} has already passed.`;
    }
  }

  for (const [k, v] of Object.entries(args)) {
    if (SHOWN_ELSEWHERE.has(k)) continue;
    const value = str(v);
    if (!value) continue;
    out.fields.push({ label: LABEL[k] ?? k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()), value });
  }
  return out;
}
