import { db } from "@/lib/db";
import { jobs } from "@/lib/jobs";
import { writeJson, readJson } from "@/lib/db/json";
import { getImageProvider } from "@/lib/images";
import { writeAudit } from "@/lib/governance";

/**
 * Auto-image for social posts — "every post defaults to having a picture".
 *
 * Runs as a BACKGROUND JOB rather than inline in the compose action: a real
 * image render takes ~10s, which would make every composer submit (and a
 * 200-row CSV import) hang on the provider. The job lands the image on the
 * post within a worker tick, well before any scheduled send.
 *
 * Honesty rules, in the house style:
 *   - OPT-OUT per workspace (`social:auto_image`; absent = ON, "false" = off) —
 *     the user's chosen default is images-on.
 *   - The MOCK provider is never attached. The mock returns an unrelated stock
 *     photo, which is success-shaped failure — exactly the bug lib/images
 *     documents. No key resolving means no image, visibly, not a fake one.
 *   - A real provider that fails THROWS, so the job records the error instead
 *     of quietly leaving the post half-done.
 *   - Only unsent posts are touched, and never one that already has media —
 *     an author's own image always wins, and history stays history.
 */

let registered = false;

export function registerSocialImageJobs() {
  if (registered) return;
  registered = true;

  jobs.register<{ postId: string }>("social.autoimage", async ({ postId }, ctx) => {
    await ctx.progress(0.1);
    const post = await db.socialPost.findUnique({
      where: { id: postId },
      include: { targets: true, campaign: { select: { name: true } }, topic: { select: { name: true } } },
    });
    if (!post) return;
    if (post.status !== "draft" && post.status !== "scheduled") return;
    if (readJson<string[]>(post.mediaKeys, []).length > 0) return; // author's image wins

    const { getSetting } = await import("@/lib/settings");
    const flag = await getSetting("social:auto_image", post.workspaceId).catch(() => "");
    if (flag === "false") return; // explicit opt-out; absent means ON

    const provider = await getImageProvider(post.workspaceId);
    if (provider.name === "mock") {
      // No usable image key for this workspace. Attaching the mock's stock
      // photo would be the picsum bug reborn — skip, and say so in the log.
      await ctx.progress(1);
      return;
    }
    await ctx.progress(0.3);

    // Square renders survive every network's cropping; only go wide when no
    // square-first network is targeted.
    const squareFirst = new Set(["instagram", "pinterest", "tiktok"]);
    const aspect = post.targets.some((t) => squareFirst.has(t.provider)) ? "1:1" : "16:9";

    // The post text is the grounding; URLs add nothing to a picture.
    const textForPrompt = post.text.replace(/https?:\/\/\S+/g, "").trim().slice(0, 600);
    const prompt =
      `Social media graphic to accompany this post: "${textForPrompt}". ` +
      `Clean, modern, professional; simple bold composition; readable if it includes a short phrase from the post; ` +
      `no watermarks, no logos, no fake UI screenshots.` +
      (post.campaign?.name ? ` Part of the "${post.campaign.name}" series — keep a consistent, minimal style.` : "");

    const img = await provider.generate({ prompt, aspectRatio: aspect, workspaceId: post.workspaceId });
    if (!img.key) return; // defensive: only real, stored bytes get attached
    await ctx.progress(0.9);

    // Re-check nothing changed while we rendered (author attached their own,
    // or the post went out): the guard ran on a snapshot, the write must not
    // trust it. updateMany with the same conditions makes the race harmless.
    await db.socialPost.updateMany({
      where: { id: post.id, status: { in: ["draft", "scheduled"] }, mediaKeys: "[]" },
      data: { mediaKeys: writeJson([img.key]) },
    });
    await writeAudit({
      workspaceId: post.workspaceId,
      action: "social.autoimage",
      entityType: "social_post",
      entityId: post.id,
      meta: { provider: img.provider, aspect },
    });
    await ctx.progress(1);
  });
}
