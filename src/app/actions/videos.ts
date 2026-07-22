"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { packageVideoCore, processRenderCore } from "@/lib/blog-autopilot";

/**
 * Phase 4 video actions. Packaging is cheap (one LLM call); rendering costs
 * real money on a live provider, so manual processing is ADMIN-only and the
 * daily cap applies in the core either way.
 */

export async function createVideoPackageAction(formData: FormData) {
  const blogPostId = String(formData.get("blogPostId"));
  const { workspace } = await requireRole("EDITOR");
  await packageVideoCore(workspace.id, blogPostId);
  revalidatePath("/videos");
  revalidatePath(`/blog/${blogPostId}`);
}

export async function processRenderNowAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await processRenderCore(workspace.id, id);
  revalidatePath("/videos");
}

export async function deleteRenderAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.videoRender.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/videos");
}
