"use server";

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
  revalidatePath(`/blog/${postId}`);
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
  revalidatePath(`/blog/${postId}`);
}

export async function addFindingToIdeasAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace, user } = await requireRole("EDITOR");
  const postId = await findingPost(workspace.id, id);
  if (!postId) return;
  await addFindingToIdeasCore(workspace.id, id, user.id);
  revalidatePath(`/blog/${postId}`);
  revalidatePath("/blog/ideas");
}
