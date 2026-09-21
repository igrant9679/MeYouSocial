import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { readJson } from "@/lib/db/json";
import { writeAudit, isGloballyPaused } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { llm, resolveUsableModel } from "@/lib/llm";
import { motifPromptFor, brandContextBlock } from "@/lib/motifs";
import { networkFor } from "@/lib/social/networks";
import { claimNextFreeSlot } from "@/lib/social/slots";

/**
 * Social drafting — an approved social idea becomes a post in the queue.
 *
 * This is the second half of what social/autogen.ts used to do in one step.
 * The WRITING of the post is kept exactly as autogen did it: the 240-character
 * text in the company's voice, the connected non-media accounts as targets,
 * the auto-image job, a claimed slot or a pending hold under
 * `social:require_approval`, the optional campaign, the `social.post_generated`
 * audit row the weekly quota counts. What changed is where the subject comes
 * from: the idea a person (or the gate) approved, with its Topic and source,
 * instead of a Topic picked by rotation.
 *
 * One post per sweep at most, up to `social:autogen_weekly` in any rolling
 * seven days — the same quota and cadence as before, so the feed's volume
 * does not change when this ships. Oldest approved idea first.
 *
 * Truthfulness rules, unchanged: the MOCK provider's output is never stored,
 * the prompt forbids invented specifics, media-required networks are excluded.
 */

const WEEK_MS = 7 * 86_400_000;
const MAX_CHARS = 240;

export async function draftSocialIdeasForWorkspace(workspaceId: string): Promise<boolean> {
  if (await isGloballyPaused(workspaceId)) return false;
  const enabled = (await getSetting("social:autogen", workspaceId).catch(() => "")) === "true";
  if (!enabled) return false;

  const target = Math.min(50, Math.max(1, parseInt(await getSetting("social:autogen_weekly", workspaceId).catch(() => ""), 10) || 5));
  const thisWeek = await db.auditLog.count({
    where: { workspaceId, action: "social.post_generated", createdAt: { gte: new Date(Date.now() - WEEK_MS) } },
  });
  if (thisWeek >= target) return false;

  const idea = await db.socialIdea.findFirst({
    where: { workspaceId, status: "approved", socialPostId: null },
    orderBy: [{ priority: "desc" }, { approvedAt: "asc" }, { createdAt: "asc" }],
    include: { topic: { select: { id: true, name: true, keywords: true } }, sourceBlogPost: { select: { id: true, title: true, publishedUrl: true } } },
  });
  if (!idea) return false;

  const accounts = await db.zernioAccount.findMany({ where: { workspaceId, status: "connected" } });
  const targets = accounts.filter((a) => !networkFor(a.platform)?.requiresMedia);
  if (targets.length === 0) return false;

  const [org, motifs, guardrails, workspace] = await Promise.all([
    db.orgProfile.findUnique({ where: { workspaceId }, select: { description: true, industry: true, audience: true } }),
    motifPromptFor(workspaceId, {}, "short").catch(() => null),
    brandContextBlock(workspaceId).catch(() => null),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, defaultModel: true } }),
  ]);
  if (!workspace) return false;

  const phrases = idea.topic ? readJson<string[]>(idea.topic.keywords, []) : [];
  const facts = [
    `Company: ${workspace.name}`,
    org?.industry ? `Industry: ${org.industry}` : "",
    org?.description ? `What it does: ${org.description}` : "",
    org?.audience ? `Audience: ${org.audience}` : "",
    idea.topic ? `Topic: ${idea.topic.name}${phrases.length ? ` (related phrases: ${phrases.slice(0, 5).join(", ")})` : ""}` : "",
    `The post's idea: ${idea.hook}${idea.angle ? ` — ${idea.angle}` : ""}`,
    idea.sourceBlogPost ? `It promotes the article "${idea.sourceBlogPost.title}"${idea.sourceBlogPost.publishedUrl ? ` at ${idea.sourceBlogPost.publishedUrl} — put that link at the end` : ""}.` : "",
  ].filter(Boolean);

  const model = await resolveUsableModel(workspace.defaultModel ?? llm.defaultModel, workspaceId);
  const res = await llm.complete({
    model,
    system:
      "You write ONE social media post for a real company's feed, from the idea you are given. " +
      "Return ONLY the post text — no preamble, no quotation marks around it, no markdown. " +
      `Hard limits: at most ${MAX_CHARS} characters${idea.sourceBlogPost?.publishedUrl ? " plus the link" : ""}, at most 2 hashtags, ${idea.sourceBlogPost?.publishedUrl ? "the article link only" : "no links"}, no emojis unless the tone calls for one. ` +
      "⚠ Never invent facts, numbers, statistics, customer names or claims — if a specific isn't in the context, don't use one. " +
      "Say the idea well, in the company's voice.",
    messages: [{
      role: "user",
      content: [`Context:\n${facts.join("\n")}`, motifs ? `Tone:\n${motifs}` : "", guardrails ?? "", "Write the post."].filter(Boolean).join("\n\n"),
    }],
    workspaceId,
    temperature: 0.8,
  });
  // ⚠ The mock is fluent. Unattended, it must never be stored — skip loudly
  // and leave the idea approved for the next sweep.
  if (res.provider === "mock" || !res.content?.trim()) {
    console.warn(`[social-drafting] ${workspaceId}: no real provider resolved (got ${res.provider}) — skipped`);
    return false;
  }
  const limit = MAX_CHARS + (idea.sourceBlogPost?.publishedUrl ? idea.sourceBlogPost.publishedUrl.length + 1 : 0);
  let text = res.content.trim().replace(/^["“]|["”]$/g, "").slice(0, limit + 40);
  if (text.length > limit) text = text.slice(0, limit).replace(/\s+\S*$/, "");

  const campaignRaw = (await getSetting("social:autogen_campaign", workspaceId).catch(() => "")).trim();
  const campaign = campaignRaw
    ? await db.campaign.findFirst({ where: { id: campaignRaw, workspaceId, status: "active" }, select: { id: true } })
    : null;

  const requireApproval = (await getSetting("social:require_approval", workspaceId).catch(() => "")) === "true";
  let scheduledAt: Date | null = null;
  let status = "draft";
  if (!requireApproval) {
    const claim = await claimNextFreeSlot(workspaceId, undefined, null);
    if (!("error" in claim)) { scheduledAt = claim.at; status = "scheduled"; }
  }

  const post = await db.socialPost.create({
    data: {
      workspaceId,
      createdById: null, // system-authored
      topicId: idea.topicId,
      campaignId: campaign?.id ?? null,
      text,
      mediaKeys: "[]",
      scheduledAt,
      status,
      approval: requireApproval ? "pending" : null,
      targets: {
        create: targets.map((a) => ({
          provider: a.platform,
          accountId: a.accountId,
          accountName: a.displayName ?? a.username ?? a.platform,
        })),
      },
    },
  });
  await db.socialIdea.update({ where: { id: idea.id }, data: { status: "drafted", socialPostId: post.id } });
  const { jobs } = await import("@/lib/jobs");
  await jobs.enqueue("social.autoimage", { postId: post.id }, { refId: post.id, workspaceId });

  await writeAudit({
    workspaceId,
    action: "social.post_generated",
    entityType: "social_post",
    entityId: post.id,
    meta: { topic: idea.topic?.name ?? null, ideaId: idea.id, source: idea.source, provider: res.provider, scheduled: Boolean(scheduledAt) },
  });
  if (requireApproval) {
    await notify({
      workspaceId,
      kind: "approval_needed",
      title: "Autopilot drafted a social post — it needs approval",
      body: text.slice(0, 140),
      path: "/social",
      entityType: "social_post",
      entityId: post.id,
    });
  }
  return true;
}
