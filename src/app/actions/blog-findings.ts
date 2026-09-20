"use server";

import { advanceIfReadyCore } from "@/lib/blog-gates";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import {
  addFindingToIdeasCore,
  answerFindingCore,
  applyFindingCore,
  dismissFindingCore,
  generateFindingsCore,
  weaveFindingCore,
} from "@/lib/blog-findings";

// Optimize → "Address these": the editor's verbs over finding cards. Every
// write goes through the cores so the autopilot and a person do the same thing.

async function findingPost(workspaceId: string, findingId: string): Promise<string | null> {
  const f = await db.blogFinding.findFirst({ where: { id: findingId, workspaceId }, select: { postId: true } });
  return f?.postId ?? null;
}

export async function generateFindingsAction(formData: FormData) {
  const postId = String(formData.get("postId"));
  const { workspace } = await requireRole("EDITOR");
  await generateFindingsCore(workspace.id, postId, { via: "editor" });
  revalidatePath(`/blog/${postId}`);
}

export async function applyFindingAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  await applyFindingCore(workspace.id, id, { actorId: user.id, via: "editor" });
  revalidatePath(`/blog/${postId}`);
}

export async function answerFindingAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  const answers = [0, 1, 2].map((i) => String(formData.get(`a${i}`) ?? ""));
  await answerFindingCore(workspace.id, id, answers, { id: user.id, name: user.name ?? null, email: user.email });
  await advanceIfReadyCore(workspace.id, postId, "answered a question");
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/inbox");
  revalidatePath("/publish");
}

/**
 * Answer every question on ONE article in a single submit (audit D6).
 *
 * The Inbox used to render one card per finding, each with up to three
 * textareas — on CommunityForce that was three cards and nine text boxes above
 * the fold, all for the same article. They are one card now, and this is its
 * one button.
 *
 * ⚠ Same cores, same order, same invariant: each finding still goes through
 * `answerFindingCore`, and `advanceIfReadyCore` still runs — once, at the end,
 * rather than per finding — so answering the last open question still advances
 * the article immediately instead of waiting for the next sweep. A finding
 * whose boxes were all left empty is skipped, not answered blank.
 */
export async function answerFindingsAction(formData: FormData) {
  const ids = String(formData.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (!ids.length) return;
  const { workspace, user } = await requireRole("EDITOR");

  let postId: string | null = null;
  let answered = 0;
  for (const id of ids) {
    const owner = await findingPost(workspace.id, id);
    // Tenancy and grouping in one: a finding from another workspace — or from
    // a different article than the card claims — is simply not answered.
    if (!owner || (postId && owner !== postId)) continue;
    postId = owner;
    const answers = [0, 1, 2].map((i) => String(formData.get(`a_${id}_${i}`) ?? ""));
    if (!answers.some((a) => a.trim())) continue;
    await answerFindingCore(workspace.id, id, answers, { id: user.id, name: user.name ?? null, email: user.email });
    answered++;
  }
  if (!postId || !answered) return;

  await advanceIfReadyCore(workspace.id, postId, answered === 1 ? "answered a question" : `answered ${answered} questions`);
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/inbox");
  revalidatePath("/publish");
}

export async function weaveFindingAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  await weaveFindingCore(workspace.id, id);
  revalidatePath(`/blog/${postId}`);
}

export async function dismissFindingAction(formData: FormData) {
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") ?? "").trim();
  const { workspace, user } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  await dismissFindingCore(workspace.id, id, user.id, reason);
  // A dismissal is a decision: if it was the last thing holding the article,
  // the article moves now, not on the next sweep.
  await advanceIfReadyCore(workspace.id, postId, "dismissed a question");
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/inbox");
  revalidatePath("/inbox");
  revalidatePath("/publish");
}

export async function addFindingToIdeasAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  await addFindingToIdeasCore(workspace.id, id, user.id);
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/ideas");
}
