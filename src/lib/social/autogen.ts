import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { readJson } from "@/lib/db/json";
import { writeAudit } from "@/lib/governance";
import { notify } from "@/lib/notify";
import { llm, resolveUsableModel } from "@/lib/llm";
import { motifPromptFor, brandContextBlock } from "@/lib/motifs";
import { engineTargets, pictureWillCome } from "@/lib/social/picture-networks";
import { claimNextFreeSlot } from "@/lib/social/slots";
import { howManyTags, settleTagLine, tagInstruction } from "@/lib/social/hashtag-text";
import { houseTags } from "@/lib/social/house-tags";

/**
 * Autonomous social post generation — "N fresh posts a week, on schedule".
 *
 * Runs from the autopilot cycle (inside its lock, gated on the SOCIAL mode
 * dial being assisted/auto, counted against the daily AI budget), and is
 * additionally OPT-IN per workspace via `social:autogen`. One post per cycle
 * at most; the 30-minute cadence spreads a week's quota across days instead
 * of dumping it in one burst.
 *
 * Truthfulness rules, non-negotiable for unattended generation:
 *   - The MOCK provider's output is never stored. An unattended pipeline
 *     queueing fluent placeholder prose into a real company's feed is the
 *     exact failure this codebase exists to prevent — no key, no post.
 *   - The prompt forbids invented specifics; grounding is the workspace's own
 *     topics, profile and published titles.
 *   - The approval workflow applies: when `social:require_approval` is on,
 *     generated posts land as PENDING drafts and notify the admins — full
 *     autonomy only happens where the workspace chose not to gate it.
 *   - Media-required networks are excluded from targets; auto-image usually
 *     attaches a picture within a minute, but "usually" is not a guarantee
 *     and an unattended send must not depend on one.
 */

const WEEK_MS = 7 * 86_400_000;
const MAX_CHARS = 240; // fits every network's limit with room for a variant

export async function generateSocialPostForWorkspace(workspaceId: string): Promise<boolean> {
  const enabled = (await getSetting("social:autogen", workspaceId).catch(() => "")) === "true";
  if (!enabled) return false;

  const target = Math.min(
    50, Math.max(1, parseInt(await getSetting("social:autogen_weekly", workspaceId).catch(() => ""), 10) || 5),
  );
  const since = new Date(Date.now() - WEEK_MS);
  const thisWeek = await db.auditLog.count({
    where: { workspaceId, action: "social.post_generated", createdAt: { gte: since } },
  });
  if (thisWeek >= target) return false;

  const accounts = await db.zernioAccount.findMany({ where: { workspaceId, status: "connected" } });
  // Text-capable accounts, plus Instagram and Pinterest when a picture is coming (lib/social/picture-networks.ts).
  const targets = engineTargets(accounts, await pictureWillCome(workspaceId));
  if (targets.length === 0) return false;

  const topics = await db.topic.findMany({
    where: { workspaceId, status: "active" },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
  });
  if (topics.length === 0) return false; // topics are the grounding — nothing to say without them
  const topic = topics[thisWeek % topics.length]; // rotate through the week's quota

  const [org, recentPosts, motifs, guardrails, workspace, house] = await Promise.all([
    db.orgProfile.findUnique({ where: { workspaceId }, select: { description: true, industry: true, audience: true } }),
    db.blogPost.findMany({
      where: { workspaceId, status: "published" },
      orderBy: { updatedAt: "desc" }, take: 3, select: { title: true },
    }),
    motifPromptFor(workspaceId, {}, "short").catch(() => null),
    brandContextBlock(workspaceId).catch(() => null),
    db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, defaultModel: true } }),
    houseTags(workspaceId).catch(() => [] as string[]),
  ]);
  if (!workspace) return false;
  // Hashtags the way the composer suggests them (2026-11-21): the brand's saved ones first, the Topic's next, as many
  // as the networks it goes to read well (the tightest wins), on one closing line.
  const tagCount = howManyTags(targets.map((a) => a.platform)).count;

  const keywords = readJson<string[]>(topic.keywords, []);
  const facts = [
    `Company: ${workspace.name}`,
    org?.industry ? `Industry: ${org.industry}` : "",
    org?.description ? `What it does: ${org.description}` : "",
    org?.audience ? `Audience: ${org.audience}` : "",
    `Topic for this post: ${topic.name}${keywords.length ? ` (related phrases: ${keywords.slice(0, 5).join(", ")})` : ""}`,
    recentPosts.length ? `Recently published articles: ${recentPosts.map((p) => p.title).join(" · ")}` : "",
  ].filter(Boolean);

  const model = await resolveUsableModel("", workspaceId, "social.draft");
  const res = await llm.complete({
    purpose: "social.draft",
    model,
    system:
      "You write ONE social media post for a real company's feed. " +
      "Return ONLY the post text — no preamble, no quotation marks around it, no markdown. " +
      `Hard limits: at most ${MAX_CHARS} characters, hashtags included; no links; no emojis unless the tone calls for one. ` +
      `${tagInstruction(tagCount, house)} ` +
      "⚠ Never invent facts, numbers, statistics, customer names or claims — if a specific isn't in the context, don't use one. " +
      "Write something genuinely useful or thought-provoking about the topic, in the company's voice.",
    messages: [{
      role: "user",
      content: [
        `Context:\n${facts.join("\n")}`,
        motifs ? `Tone:\n${motifs}` : "",
        guardrails ?? "",
        "Write the post.",
      ].filter(Boolean).join("\n\n"),
    }],
    workspaceId,
    temperature: 0.8,
  });

  // ⚠ The mock is fluent. Unattended, it must never be stored — skip loudly.
  if (res.provider === "mock" || !res.content?.trim()) {
    console.warn(`[social-autogen] ${workspaceId}: no real provider resolved (got ${res.provider}) — skipped`);
    return false;
  }
  // The closing hashtag line settled and the whole kept within MAX_CHARS by shortening the body, never a tag.
  const text = settleTagLine(res.content.trim().replace(/^["“]|["”]$/g, ""), { count: tagCount, house, limit: MAX_CHARS });

  // Optional campaign; validated so a stale id degrades to none.
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
      source: "engine",
      topicId: topic.id,
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
  const { jobs } = await import("@/lib/jobs");
  await jobs.enqueue("social.autoimage", { postId: post.id }, { refId: post.id, workspaceId });

  await writeAudit({
    workspaceId,
    action: "social.post_generated",
    entityType: "social_post",
    entityId: post.id,
    meta: { topic: topic.name, provider: res.provider, scheduled: Boolean(scheduledAt) },
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
