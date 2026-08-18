"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks, requiredChecksPass } from "@/lib/blog-checks";
import { writeAudit } from "@/lib/governance";
import { generateDraftCore } from "@/lib/blog-autopilot";
import { blocksToPlainText, parseBlocks, serializeBlocks } from "@/lib/blocks";
import { jobs } from "@/lib/jobs";
import { readMotifWeights, serializeMotifs } from "@/lib/motifs";
import { loadAssetGate } from "@/lib/blog-images";
import { loadEditorialContext } from "@/lib/blog-slop";
import { notify } from "@/lib/notify";
import { autoTaskForAssets, autoTaskForReview } from "@/lib/auto-tasks";

/**
 * Blog module (ported from Spark's article pipeline — slice 1).
 * Spark guardrails carried over: the AI never invents metrics/quotes; drafts
 * flag unverifiable claims with [NEEDS SOURCE]; publish requires walking the
 * review chain (drafting → draft_review → final_approval → published) — no
 * skipping straight to published.
 */

const STATUS_FLOW = ["drafting", "draft_review", "final_approval", "published"] as const;
type BlogStatus = (typeof STATUS_FLOW)[number];

function isStatus(s: string): s is BlogStatus {
  return (STATUS_FLOW as readonly string[]).includes(s);
}

export async function createBlogPostAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const { user, workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.create({
    data: {
      workspaceId: workspace.id,
      title,
      audience: String(formData.get("audience") ?? "").trim() || null,
      focusKeyword: String(formData.get("focusKeyword") ?? "").trim() || null,
      createdById: user.id,
    },
  });
  revalidatePath("/blog");
  redirect(`/blog/${post.id}`);
}

export async function updateBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  const num = (v: FormDataEntryValue | null) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

  const newBody = str(formData.get("body"));
  const pick = (k: string, allowed: string[]) => {
    const v = str(formData.get(k));
    return v && allowed.includes(v) ? v : null;
  };
  const csvJson = (v: FormDataEntryValue | null) =>
    JSON.stringify(
      String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
    );
  const tierRaw = parseInt(String(formData.get("contentTier") ?? ""), 10);
  const tier = Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 4 ? tierRaw : null;
  const secondaryRaw = str(formData.get("secondaryKeywords"));
  const secondary = secondaryRaw
    ? JSON.stringify(secondaryRaw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 8))
    : "[]";
  // Optional workspace Topic — validated so a stale or foreign id can't attach.
  const topicRaw = str(formData.get("topicId"));
  const topicId = topicRaw
    ? (await db.topic.findFirst({ where: { id: topicRaw, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.blogPost.update({
    where: { id: post.id },
    data: {
      title: str(formData.get("title")) ?? post.title,
      slug: str(formData.get("slug")),
      metaTitle: str(formData.get("metaTitle")),
      metaDescription: str(formData.get("metaDescription")),
      focusKeyword: str(formData.get("focusKeyword")),
      audience: str(formData.get("audience")),
      wordCountTarget: num(formData.get("wordCountTarget")),
      // FR-2: the motif blend replaces the old 4-option tone select.
      motifs: serializeMotifs(readMotifWeights(formData)),
      contentTier: tier,
      topicId,
      smeProfileId: str(formData.get("smeProfileId")), // blank = auto-match by topic
      readingLevel: pick("readingLevel", ["simple", "standard", "advanced"]),
      templateKey: str(formData.get("templateKey")),
      model: str(formData.get("model")),
      secondaryKeywords: secondary,
      // FR-7 publish fidelity
      canonicalUrl: str(formData.get("canonicalUrl")),
      ogTitle: str(formData.get("ogTitle")),
      ogDescription: str(formData.get("ogDescription")),
      categories: csvJson(formData.get("categories")),
      tags: csvJson(formData.get("tags")),
      body: newBody,
    },
  });
  if (newBody !== post.body) await snapshotVersion(post.id, "saved", newBody);
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
}

/** Move a post one step forward/backward along the review chain. */
export async function advanceBlogStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const dir = String(formData.get("dir")) === "back" ? -1 : 1;
  // Final approval → published is an approval act: ADMIN. Everything else: EDITOR.
  const { user, workspace, membership } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || !isStatus(post.status)) return;

  const idx = STATUS_FLOW.indexOf(post.status);
  const next = STATUS_FLOW[idx + dir];
  if (!next) return;
  if (next === "published" && membership.role !== "ADMIN") return; // human gate
  if (dir > 0 && (next === "final_approval" || next === "published")) {
    // Spark gate: checks must pass and citations must be verified to advance
    // into approval/publish. Server-enforced — the UI banner is advisory only.
    const unverified = await db.blogCitation.count({ where: { postId: post.id, verified: false } });
    const [assets, editorial] = await Promise.all([
      loadAssetGate(workspace.id, post.id),
      loadEditorialContext(workspace.id, post),
    ]);
    if (!requiredChecksPass(runBlogChecks(post, unverified, assets, editorial))) return;
  }

  // ⚠ With a WordPress connection, "publish" must MEAN publish. This action
  // used to flip the status and stop — the app said "published" while the
  // site got nothing (found by the user on the first real publish,
  // 2026-08-12). The bare status flip remains ONLY for installs with no WP
  // connection, where publishing genuinely happens elsewhere (HTML export).
  if (next === "published" && dir > 0 && !post.wpPostId) {
    const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
    if (conn) {
      const { publishCore } = await import("@/lib/blog-autopilot");
      let failure: string | null = null;
      let ok = false;
      try {
        ok = await publishCore(workspace.id, post.id);
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (!ok) {
        // Status unchanged — the state stays true. Name the failure.
        redirect(
          `/blog/${post.id}?flashErr=${encodeURIComponent(
            `WordPress publish failed — the post was NOT marked published. ${failure ?? "Check the connection on Distribute → Website."}`.slice(0, 300),
          )}`,
        );
      }
      // publishCore set status/publishedUrl/wpPostId (or left it at final
      // approval for a draft handoff) and wrote its own audit.
      const after = await db.blogPost.findUnique({ where: { id: post.id }, select: { status: true, publishedUrl: true } });
      redirect(
        `/blog/${post.id}?flash=${encodeURIComponent(
          after?.status === "published"
            ? `Published to WordPress: ${after.publishedUrl ?? "link pending"}`
            : "Handed off as a WordPress draft — publish it on the site when ready.",
        )}`,
      );
    }
  }

  await db.blogPost.update({
    where: { id: post.id },
    data: {
      status: next,
      publishedAt: next === "published" ? new Date() : null,
    },
  });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: next === "published" ? "blog.published" : `blog.status_${next}`,
    entityType: "blog_post",
    entityId: post.id,
  });
  // Production auto-tasks: pipeline events become work items (rules on the
  // Tasks page). Review task when a draft parks at review; asset task when a
  // post reaches approval still missing its images.
  if (dir > 0 && next === "draft_review") {
    await autoTaskForReview(workspace.id, post);
  }
  if (dir > 0 && next === "final_approval") {
    const images = await db.blogImage.findMany({ where: { postId: post.id }, select: { role: true, status: true } });
    const ok = (role: string) => images.some((i) => i.role === role && i.status === "approved");
    if (!ok("featured") || !ok("og")) await autoTaskForAssets(workspace.id, post);
  }

  // FR-16: tell whoever has to act next. Never the person who just acted.
  if (next === "final_approval") {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: `"${post.title}" is waiting for final approval`,
      body: "Gates passed. Publishing is an admin act.",
      path: `/blog/${post.id}`,
      entityType: "blog_post",
      entityId: post.id,
      excludeUserId: user.id,
    });
  } else if (next === "draft_review" && dir > 0) {
    await notify({
      workspaceId: workspace.id,
      kind: "approval_needed",
      title: `"${post.title}" is ready for draft review`,
      path: `/blog/${post.id}`,
      entityType: "blog_post",
      entityId: post.id,
      userIds: post.reviewerId ? [post.reviewerId] : undefined,
      excludeUserId: user.id,
    });
  } else if (next === "published") {
    await notify({
      workspaceId: workspace.id,
      kind: "published",
      title: `"${post.title}" was published`,
      path: `/blog/${post.id}`,
      entityType: "blog_post",
      entityId: post.id,
      excludeUserId: user.id,
    });
  }
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
}

export async function deleteBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.blogPost.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/blog");
  redirect("/blog");
}

/**
 * AI draft: grounded in the workspace's active channel voice/audience when one
 * exists, plus the post's own audience/keyword targets. Truthfulness rules from
 * Spark ride in the system prompt.
 */
export async function generateBlogDraftAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  // Guardrails (global pause, protect-from-rewrite), grounding, and citation
  // extraction live in the core — shared with the autopilot scheduler.
  if (await generateDraftCore(workspace.id, id)) {
    // …and so is finishing: park at review (only from `drafting`, so a re-draft
    // of a published post can't be dragged backwards), images, SEO meta. In a
    // job so the editor's button returns as soon as the prose exists.
    await jobs.enqueue("blog.finishdraft", { workspaceId: workspace.id, postId: id }, { refId: id, workspaceId: workspace.id });
  }
  revalidatePath(`/blog/${id}`);
}

/** Debounced autosave from the editor — body only, no version churn. */
export async function autosaveBlogBodyAction(formData: FormData) {
  const id = String(formData.get("id"));
  const body = String(formData.get("body") ?? "");
  const { workspace } = await requireRole("EDITOR");
  await db.blogPost.updateMany({
    where: { id, workspaceId: workspace.id },
    data: { body: body || null },
  });
}

/** Keep the last 20 versions per post. */
async function snapshotVersion(postId: string, label: string, body: string | null) {
  await db.blogPostVersion.create({ data: { postId, label, body } });
  const excess = await db.blogPostVersion.findMany({
    where: { postId },
    orderBy: { createdAt: "desc" },
    skip: 20,
    select: { id: true },
  });
  if (excess.length) {
    await db.blogPostVersion.deleteMany({ where: { id: { in: excess.map((v) => v.id) } } });
  }
}

export async function restoreBlogVersionAction(formData: FormData) {
  const versionId = String(formData.get("versionId"));
  const { workspace } = await requireRole("EDITOR");
  const version = await db.blogPostVersion.findFirst({
    where: { id: versionId, post: { workspaceId: workspace.id } },
    include: { post: { select: { id: true, body: true } } },
  });
  if (!version) return;
  await snapshotVersion(version.post.id, "before restore", version.post.body);
  await db.blogPost.update({ where: { id: version.post.id }, data: { body: version.body } });
  revalidatePath(`/blog/${version.post.id}`);
}

/**
 * Schedule (or unschedule) publishing. ADMIN act at final_approval — setting a
 * time is the human approval that lets the autopilot publish when it's due,
 * even in assisted mode. Gates still re-verify at the moment of publish.
 */
export async function scheduleBlogPostAction(formData: FormData) {
  const id = String(formData.get("id"));
  const when = String(formData.get("scheduledAt") ?? "").trim();
  const { user, workspace } = await requireRole("ADMIN");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post || post.status !== "final_approval") return;

  const date = when ? new Date(when) : null;
  if (date && Number.isNaN(date.getTime())) return;
  await db.blogPost.update({ where: { id: post.id }, data: { scheduledAt: date } });
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: date ? "blog.scheduled" : "blog.unscheduled",
    entityType: "blog_post",
    entityId: post.id,
    meta: date ? { scheduledAt: date.toISOString() } : {},
  });
  if (date) {
    await notify({
      workspaceId: workspace.id,
      kind: "scheduled",
      title: `"${post.title}" is scheduled for ${date.toISOString().slice(0, 16).replace("T", " ")}`,
      body: "The gates are re-checked at the moment of publish.",
      path: `/blog/${post.id}`,
      entityType: "blog_post",
      entityId: post.id,
      excludeUserId: user.id,
    });
  }
  revalidatePath(`/blog/${post.id}`);
}

// ---- Citations ---------------------------------------------------------------

export async function addCitationAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const claim = String(formData.get("claim") ?? "").trim();
  if (!claim) return;
  const { workspace } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id: postId, workspaceId: workspace.id } });
  if (!post) return;
  await db.blogCitation.create({ data: { postId, claim, sourceUrl: String(formData.get("sourceUrl") ?? "").trim() || null } });
  revalidatePath(`/blog/${postId}`);
}

export async function verifyCitationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!cit) return;
  // Verification requires a source URL — a claim can't be "verified" against nothing.
  if (!sourceUrl && !cit.sourceUrl) return;
  await db.blogCitation.update({
    where: { id },
    data: { verified: true, sourceUrl: sourceUrl || cit.sourceUrl },
  });
  revalidatePath(`/blog/${cit.postId}`);
}

export async function deleteCitationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!cit) return;
  await db.blogCitation.delete({ where: { id } });
  revalidatePath(`/blog/${cit.postId}`);
}

// ---- Org profile -------------------------------------------------------------

export async function saveOrgProfileAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const str = (k: string) => String(formData.get(k) ?? "").trim() || null;

  // The block editor submits both its blocks and a plain-text copy. ⚠ The
  // PLAIN TEXT IS RE-DERIVED HERE rather than trusted: `description` is what
  // every prompt in the app is grounded in, and a stale or hand-crafted hidden
  // field would silently teach the model something the author never wrote.
  // No blocks (JS off, or an older form) means the textarea is the truth, so
  // the field degrades instead of blanking.
  const rawBlocks = String(formData.get("descriptionBlocks") ?? "").trim();
  const blocks = rawBlocks ? parseBlocks(rawBlocks) : [];
  const description = blocks.length ? blocksToPlainText(blocks) || null : str("description");
  const descriptionBlocks = blocks.length ? serializeBlocks(blocks) : rawBlocks ? null : undefined;

  const data = {
    description,
    industry: str("industry"),
    audience: str("audience"),
    ...(descriptionBlocks === undefined ? {} : { descriptionBlocks }),
  };
  await db.orgProfile.upsert({
    where: { workspaceId: workspace.id },
    update: data,
    create: { workspaceId: workspace.id, ...data },
  });
  revalidatePath("/blog/organization");
  revalidatePath("/brand");
  revalidatePath("/blog");
}
