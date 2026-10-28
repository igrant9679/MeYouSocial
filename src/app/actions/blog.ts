"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { runBlogChecks } from "@/lib/blog-checks";
import { advanceIfReadyCore, bodyHash, CLEAR_APPROVAL, clearGateOverrideCore, gatesSatisfied, overrideGateCore, returnToReviewAfterEdit } from "@/lib/blog-gates";
import { writeAudit } from "@/lib/governance";
import { linkMarkerForClaim, removeMarkerForClaim, webUrl } from "@/lib/blog-autoreview";
import { generateDraftCore } from "@/lib/blog-autopilot";
import { richTextToPlainText, sanitizeRichHtml, unwrapBlockParagraphs } from "@/lib/richtext";
import { stripExecutableHtml } from "@/lib/html-safety";
import { jobs } from "@/lib/jobs";
import { readMotifWeights, serializeMotifs } from "@/lib/motifs";
import { loadAssetGate } from "@/lib/blog-images";
import { loadEditorialContext } from "@/lib/blog-slop";
import { notify } from "@/lib/notify";
import { autoTaskForAssets, autoTaskForReview } from "@/lib/auto-tasks";
import { cleanTitle } from "@/lib/list-marker";
import { modelChoiceProblem } from "@/lib/llm";
import { formatInZone, getPostingTimeZone, parseZonedInput } from "@/lib/social/slots";

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

/** The body as Save and autosave store it — see autosaveBlogBodyAction. */
function normaliseBody(body: string | null): string | null {
  return body ? stripExecutableHtml(unwrapBlockParagraphs(body)) || null : null;
}

export async function createBlogPostAction(formData: FormData) {
  const title = cleanTitle(String(formData.get("title") ?? ""), 300);
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
  const { workspace, user } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!post) return;

  const num = (v: FormDataEntryValue | null) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

  // Same normalisation as autosave — see autosaveBlogBodyAction.
  const rawBody = str(formData.get("body"));
  const newBody = rawBody ? stripExecutableHtml(unwrapBlockParagraphs(rawBody)) : null;
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
  // The last line of defence for an article title: whatever route it took
  // to get here, list furniture never reaches a reader (audit A3).
  const title = cleanTitle(String(formData.get("title") ?? ""), 300) || post.title;
  const slug = str(formData.get("slug"));
  const metaTitle = str(formData.get("metaTitle"));
  const metaDescription = str(formData.get("metaDescription"));
  // What a reader would see change — an approved article goes back to review.
  // The stored body is compared normalised the same way, so saving an
  // untouched AI draft (stored before normalising) isn't mistaken for an edit.
  // The editor sends the hash of the body it loaded; a different stored body
  // means someone else wrote it meanwhile, and this save must not undo that.
  const base = String(formData.get("baseHash") ?? "");
  const bodyConflict = Boolean(base) && base !== bodyHash(post.body) && newBody !== normaliseBody(post.body);
  // Only a model that can write here (audit SET-01). A refused one keeps the
  // stored choice and the rest of the save goes through.
  const modelProblem = await modelChoiceProblem(str(formData.get("model")), workspace.id, post.model);
  const wordsChanged = (!bodyConflict && newBody !== normaliseBody(post.body)) || title !== post.title || slug !== post.slug ||
    metaTitle !== post.metaTitle || metaDescription !== post.metaDescription;
  await db.blogPost.update({
    where: { id: post.id },
    data: {
      title,
      slug,
      metaTitle,
      metaDescription,
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
      model: modelProblem ? post.model : str(formData.get("model")),
      secondaryKeywords: secondary,
      // FR-7 publish fidelity
      canonicalUrl: str(formData.get("canonicalUrl")),
      ogTitle: str(formData.get("ogTitle")),
      ogDescription: str(formData.get("ogDescription")),
      categories: csvJson(formData.get("categories")),
      tags: csvJson(formData.get("tags")),
      // The text only if it is still the one the editor opened (ART-03).
      ...(bodyConflict ? {} : { body: newBody }),
    },
  });
  if (bodyConflict) {
    // The newer text stays; theirs is kept where they can get it back.
    await snapshotVersion(post.id, CONFLICT_LABEL, newBody);
  } else if (newBody !== post.body) {
    await snapshotVersion(post.id, "saved", newBody);
  }
  if (wordsChanged) await returnToReviewAfterEdit(workspace.id, post.id, "edit", user.id);
  revalidatePath(`/blog/${post.id}`);
  revalidatePath("/blog");
  if (bodyConflict) {
    redirect(`/blog/${post.id}?flashErr=${encodeURIComponent(`The article's text changed elsewhere while you were editing (the engine, Verify, or another tab). The newer text was kept; yours is under Versions as “your edit, kept”. Your other fields were saved.${modelProblem ? ` The model wasn't changed: ${modelProblem}` : ""}`)}`);
  }
  if (modelProblem) redirect(`/blog/${post.id}?flashErr=${encodeURIComponent(`Your other changes were saved; the model wasn't changed. ${modelProblem}`)}`);
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
    // An admin's "Advance anyway" override counts as passing (lib/blog-gates.ts).
    if (!gatesSatisfied(post, runBlogChecks(post, unverified, assets, editorial))) return;
  }

  // ⚠ With a WordPress connection, "publish" must MEAN publish. This action
  // used to flip the status and stop — the app said "published" while the
  // site got nothing (found by the user on the first real publish,
  // 2026-08-12). The bare status flip remains ONLY for installs with no WP
  // connection, where publishing genuinely happens elsewhere (HTML export).
  if (next === "published" && dir > 0) {
    const conn = await db.wordPressConnection.findUnique({ where: { workspaceId: workspace.id } });
    // ⚠ No website: this flipped the article to published with no URL, told
    // everyone it "was published", and social posts followed with no link
    // (ART-12, live on CF). Publishing without WordPress is a person's act with
    // a live link: Download HTML, then Mark as published.
    if (!conn) {
      redirect(
        `/blog/${post.id}?flashErr=${encodeURIComponent(
          "No website is connected, so the app can't publish this itself. Download the HTML, add it to your site, then use Mark as published with its live link.",
        )}`,
      );
    }
    // A WordPress draft hand-off: publish it THERE, and only call it published
    // once the site says it's live (ART-10).
    if (post.wpPostId && !post.refreshStartedAt) {
      const { publishWordPressDraftCore } = await import("@/lib/blog-autopilot");
      const r = await publishWordPressDraftCore(workspace.id, post.id);
      redirect(
        r.ok
          ? `/blog/${post.id}?flash=${encodeURIComponent(`Published on WordPress: ${r.link || "link pending"}`)}`
          : `/blog/${post.id}?flashErr=${encodeURIComponent(`Not published: ${r.reason}`.slice(0, 300))}`,
      );
    }
  }
  // A new article, or a refresh of a live one (publishCore updates it in place).
  if (next === "published" && dir > 0 && (!post.wpPostId || post.refreshStartedAt)) {
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
      // Back out of final approval: the publish date and any override were
      // part of approving it, so they go too (audit ART-21). Otherwise a date
      // set before Back published the article on the first sweep after it
      // was approved again.
      ...(dir < 0 && post.status === "final_approval" ? CLEAR_APPROVAL : {}),
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
  const { workspace, user } = await requireRole("EDITOR");
  const post = await db.blogPost.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, status: true, body: true, wpPostId: true, scheduledAt: true },
  });
  if (!post) return;
  // ⚠ Regenerating an approved or live article used to rewrite it in place
  // (audit ART-21): a final-approval body changed under its approval and
  // published on the next sweep; a published one drifted from its live page.
  // Now the article is taken out of its approved state FIRST — before the
  // writer runs, so no sweep can publish a half-made body — and put back
  // exactly as it was if the writer doesn't answer.
  //   · final approval → back through review (the publish date and any
  //     override don't survive it);
  //   · live on WordPress → a refresh: the writer revises the live text and
  //     its publish updates the same post in place;
  //   · published elsewhere by hand → refused: the copy here would stop
  //     matching the live page and nothing could publish it.
  const restore: { status: string; scheduledAt?: Date | null; refreshStartedAt?: null } | null =
    post.status === "final_approval" ? { status: "final_approval", scheduledAt: post.scheduledAt }
      : post.status === "published" ? { status: "published", refreshStartedAt: null }
        : null;
  if (post.status === "published" && post.wpPostId == null) {
    redirect(`/blog/${id}?flashErr=${encodeURIComponent("This article was published outside the app, so a regenerated draft couldn't replace the live page. Edit it by hand here and on your site, or start a new article.")}`);
  }
  if (restore) {
    const moved = await db.blogPost.updateMany({
      where: { id, workspaceId: workspace.id, status: post.status },
      data: post.status === "published" ? { status: "drafting", refreshStartedAt: new Date() } : { status: "drafting", scheduledAt: null },
    });
    if (!moved.count) return; // it changed state just now — leave it to whoever moved it
  }
  // Guardrails (global pause, protect-from-rewrite), grounding, and citation
  // extraction live in the core — shared with the autopilot scheduler.
  const ok = await generateDraftCore(workspace.id, id, post.status === "published" ? { refreshOf: post.body, actorId: user.id } : { actorId: user.id });
  if (!ok) {
    if (restore) await db.blogPost.updateMany({ where: { id, workspaceId: workspace.id, status: "drafting" }, data: restore });
    revalidatePath(`/blog/${id}`);
    return;
  }
  if (restore) {
    // The new body isn't the one any override was given for; drop it outright.
    await db.blogPost.update({ where: { id }, data: { gateOverrideAt: null, gateOverrideById: null, gateOverrideReason: null, gateOverrideHash: null } });
    await writeAudit({
      workspaceId: workspace.id, actorId: user.id, entityType: "blog_post", entityId: id,
      action: post.status === "published" ? "blog.refresh_started" : "blog.returned_to_review",
      meta: { via: "regenerate" },
    });
  }
  // …and so is finishing: park at review (only from `drafting`), images, SEO
  // meta. In a job so the editor's button returns as soon as the prose exists.
  await jobs.enqueue("blog.finishdraft", { workspaceId: workspace.id, postId: id }, { refId: id, workspaceId: workspace.id });
  revalidatePath(`/blog/${id}`);
}

/** An admin takes back their "Advance anyway" (ART-09). */
export async function clearGateOverrideAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { workspace, user } = await requireRole("ADMIN");
  const r = await clearGateOverrideCore(workspace.id, id, user.id);
  revalidatePath(`/blog/${id}`);
  revalidatePath("/inbox");
  revalidatePath("/publish");
  redirect(`/blog/${id}?tab=review&flash=${encodeURIComponent(
    !r.cleared ? "There was no override to clear."
      : r.backToReview ? "Override cleared — the article is back at review until its checks pass."
        : "Override cleared — the checks decide from here.",
  )}`);
}

/** Debounced autosave from the editor — body only, no version churn. */
export async function autosaveBlogBodyAction(formData: FormData) {
  const id = String(formData.get("id"));
  // ⚠ Normalised on the way in. Chrome's list command returns
  // `<p><ul><li>…</li></ul></p>` — invalid HTML that every reader re-parses
  // differently, and this body is what publishCore sends to WordPress. Proven
  // by clicking the toolbar on production and reading the row back.
  // ⚠ And stripped of anything executable: this body is rendered back into
  // the editor as HTML, so an <img onerror=…> saved here ran as whoever opened
  // the article next (an admin, or the platform operator). lib/html-safety.ts.
  const body = stripExecutableHtml(unwrapBlockParagraphs(String(formData.get("body") ?? "")));
  const base = String(formData.get("baseHash") ?? "");
  const { workspace, user } = await requireRole("EDITOR");
  const before = await db.blogPost.findFirst({ where: { id, workspaceId: workspace.id }, select: { body: true } });
  if (!before) return { ok: false as const, reason: "gone" as const };
  // ⚠ The body the editor started from must still be the stored one (ART-03).
  // Auto-review links, applied findings and Inbox Verify rewrite the body
  // while a tab is open; the tab's next autosave used to put the old text
  // back — [NEEDS SOURCE] marker and all. Now it's refused, the person's text
  // is kept as a version, and the editor says so. The swap is conditional on
  // the body too, so two writers can't both pass the check.
  const current = bodyHash(before.body);
  if (base && base !== current) {
    const kept = await db.blogPostVersion.findFirst({ where: { postId: id, label: CONFLICT_LABEL, body }, select: { id: true } });
    if (!kept) await snapshotVersion(id, CONFLICT_LABEL, body || null);
    return { ok: false as const, reason: "conflict" as const, hash: current };
  }
  const saved = await db.blogPost.updateMany({
    where: { id, workspaceId: workspace.id, body: before.body },
    data: { body: body || null },
  });
  if (saved.count !== 1) return { ok: false as const, reason: "conflict" as const, hash: bodyHash((await db.blogPost.findUnique({ where: { id }, select: { body: true } }))?.body) };
  // Typing into an approved or live article is an edit like any other (ART-21).
  if ((body || null) !== normaliseBody(before.body)) await returnToReviewAfterEdit(workspace.id, id, "edit", user.id);
  return { ok: true as const, hash: bodyHash(body || null) };
}

/** The version label for an edit that met a newer body (ART-03). */
const CONFLICT_LABEL = "your edit, kept — the article changed elsewhere";

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
  const { workspace, user } = await requireRole("EDITOR");
  const version = await db.blogPostVersion.findFirst({
    where: { id: versionId, post: { workspaceId: workspace.id } },
    include: { post: { select: { id: true, body: true } } },
  });
  if (!version) return;
  await snapshotVersion(version.post.id, "before restore", version.post.body);
  await db.blogPost.update({ where: { id: version.post.id }, data: { body: version.body } });
  if (version.body !== version.post.body) await returnToReviewAfterEdit(workspace.id, version.post.id, "version restore", user.id);
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

  // Wall clock in the posting timezone: read as server UTC, 09:00 New York
  // published at 05:00 while the editor still showed 09:00 (ART-04).
  const tz = await getPostingTimeZone(workspace.id);
  const date = when ? parseZonedInput(when, tz) : null;
  if (when && !date) return;
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
      title: `"${post.title}" is scheduled for ${formatInZone(date, tz)} ${tz}`,
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
  const { workspace, user } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({
    where: { id, post: { workspaceId: workspace.id } },
  });
  if (!cit) return;
  // Verification requires a source URL — a claim can't be "verified" against nothing.
  // It is written into the article as a link, so only a web address is taken.
  const url = webUrl(sourceUrl || cit.sourceUrl || "");
  if (!url) return;
  await db.blogCitation.update({
    where: { id },
    data: { verified: true, sourceUrl: url },
  });
  // The marker becomes the link, as when auto-review sources a claim — the
  // required check counts markers, so a verified row alone held the article.
  const markerLinked = await linkMarkerForClaim(cit.postId, cit.claim, url);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.citation_verified",
    entityType: "blog_post",
    entityId: cit.postId,
    meta: { citationId: id, sourceUrl: url, via: "inbox", markerLinked },
  });
  // Verifying the claim that held the article moves it now, not next sweep.
  await advanceIfReadyCore(workspace.id, cit.postId, "verified a claim");
  revalidatePath(`/blog/${cit.postId}`);
  revalidatePath("/inbox");
  revalidatePath("/inbox");
  revalidatePath("/publish");
}

/**
 * "Advance anyway" — an admin overrides the required checks on a held
 * article. Recorded on the post and in the audit log with the reason; the
 * article moves to final approval now, and the override carries through the
 * sweep's advance and publishing (lib/blog-gates.ts).
 */
export async function overrideGateAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const { workspace, user } = await requireRole("ADMIN");
  const result = await overrideGateCore(workspace.id, id, user.id, reason);
  if (!result) return;
  revalidatePath(`/blog/${id}`);
  revalidatePath("/inbox");
  revalidatePath("/inbox");
  revalidatePath("/publish");
  const what = result.failing.length ? ` Overrode: ${result.failing.join("; ")}.` : "";
  redirect(`/inbox?flash=${encodeURIComponent(result.moved ? `Advanced to final approval on your say-so — recorded with your name.${what}` : `Override recorded, but the article is not at review, so nothing moved.${what}`)}`);
}

export async function deleteCitationAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const cit = await db.blogCitation.findFirst({ where: { id, post: { workspaceId: workspace.id } } });
  if (!cit) return;
  await db.blogCitation.delete({ where: { id } });
  // The marker is what the required check counts, and auto-review mints a
  // fresh row for any marker without one — so dropping the record alone
  // brought the claim straight back on the next sweep. Drop the marker too.
  const markerRemoved = await removeMarkerForClaim(cit.postId, cit.claim);
  await writeAudit({
    workspaceId: workspace.id,
    actorId: user.id,
    action: "blog.citation_dropped",
    entityType: "blog_post",
    entityId: cit.postId,
    meta: { citationId: id, claim: cit.claim.slice(0, 200), markerRemoved },
  });
  // Dropping the claim that held the article moves it now, not next sweep.
  await advanceIfReadyCore(workspace.id, cit.postId, "dropped a claim");
  revalidatePath(`/blog/${cit.postId}`);
  revalidatePath("/inbox");
  revalidatePath("/inbox");
  revalidatePath("/publish");
}

// ---- Org profile -------------------------------------------------------------

export async function saveOrgProfileAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const str = (k: string) => String(formData.get(k) ?? "").trim() || null;

  // The editor submits rich HTML. ⚠ IT IS SANITIZED AND THE PLAIN TEXT IS
  // RE-DERIVED HERE, never trusted from the client: `description` is what every
  // prompt in the app is grounded in, and this HTML is rendered back into a
  // page. A stale or hand-crafted hidden field would otherwise teach the model
  // something the author never wrote — or store a script tag.
  // No HTML (JS off, or an older form) means the textarea is the truth, so the
  // field degrades instead of blanking.
  const rawHtml = String(formData.get("descriptionHtml") ?? "").trim();
  const descriptionHtml = rawHtml ? sanitizeRichHtml(rawHtml) : "";
  const description = descriptionHtml ? richTextToPlainText(descriptionHtml) || null : str("description");

  const data = {
    description,
    industry: str("industry"),
    audience: str("audience"),
    ...(rawHtml ? { descriptionHtml: descriptionHtml || null } : {}),
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
