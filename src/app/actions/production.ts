"use server";

import { revalidatePath as rp } from "next/cache";
import { requireRole as rr } from "@/lib/acl";
import { db as prisma } from "@/lib/db";
import { DEFAULT_AUTO_RULES } from "@/lib/auto-tasks";

/**
 * Plain-args action for the drag-and-drop task board (client invokes it
 * directly, no form). Workspace-scoped like everything else.
 */
export async function moveTaskAction(taskId: string, status: string) {
  if (!["todo", "in_progress", "done"].includes(status)) return;
  const { workspace } = await rr("EDITOR");
  await prisma.task.updateMany({
    where: { id: taskId, workspaceId: workspace.id },
    data: { status },
  });
  rp("/production/tasks");
}

/** Admin: the auto-task rules + WIP limit, edited on the Tasks page. */
export async function saveAutoTaskRulesAction(formData: FormData) {
  const { workspace } = await rr("ADMIN");
  const wipRaw = parseInt(String(formData.get("wipLimit")), 10);
  const rules = {
    reviewTask: formData.get("reviewTask") === "on",
    assetTask: formData.get("assetTask") === "on",
    renderFailTask: formData.get("renderFailTask") === "on",
    wipLimit: Number.isFinite(wipRaw) && wipRaw >= 1 && wipRaw <= 20 ? wipRaw : DEFAULT_AUTO_RULES.wipLimit,
  };
  const { setWorkspaceSetting } = await import("@/lib/settings");
  await setWorkspaceSetting(workspace.id, "production:autotasks", JSON.stringify(rules));
  rp("/production/tasks");
}

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeJson } from "@/lib/db/json";

// All Phase 5 actions: ContentProject lifecycle, Tasks, Calendar, Assets, Swipes, Wiki.

// ── ContentProject ────────────────────────────────────────────────────────

const projectStatuses = ["idea", "research_writing", "recording", "editing", "scheduled", "published"] as const;
const editStatuses = ["assembly", "rough_cut", "vfx", "sound_music", "color"] as const;

export async function promoteScriptAction(formData: FormData) {
  const scriptId = String(formData.get("scriptId"));
  const { workspace } = await requireRole("EDITOR");
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId: workspace.id } },
    include: { contentProject: true },
  });
  if (!script) return;
  if (script.contentProject) {
    const { redirect } = await import("next/navigation");
    redirect(`/production/projects/${script.contentProject.id}`);
  }
  const project = await db.contentProject.create({
    data: {
      channelId: script.channelId,
      scriptId: script.id,
      title: script.title,
      format: "long",
      status: "research_writing",
    },
  });
  const { redirect } = await import("next/navigation");
  redirect(`/production/projects/${project.id}`);
}

export async function createProjectAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const channelId = String(formData.get("channelId"));
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const ok = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
  if (!ok) return;
  const rawTopic = String(formData.get("topicId") ?? "").trim();
  const topicId = rawTopic
    ? (await db.topic.findFirst({ where: { id: rawTopic, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.contentProject.create({
    data: { channelId, title, status: "idea", format: "long", topicId },
  });
  revalidatePath("/production");
}

/**
 * Assign (or clear) the workspace Topic on a production project. Validated via
 * the project's channel workspace and the topic's own workspace.
 */
export async function setProjectTopicAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("topicId") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  const project = await db.contentProject.findFirst({
    where: { id, channel: { workspaceId: workspace.id } },
    select: { id: true },
  });
  if (!project) return;
  const topicId = raw
    ? (await db.topic.findFirst({ where: { id: raw, workspaceId: workspace.id }, select: { id: true } }))?.id ?? null
    : null;
  await db.contentProject.update({ where: { id: project.id }, data: { topicId } });
  revalidatePath("/production");
  revalidatePath(`/production/projects/${project.id}`);
}

export async function setProjectStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!projectStatuses.includes(status as typeof projectStatuses[number])) return;
  const { workspace } = await requireRole("EDITOR");
  await db.contentProject.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { status },
  });
  revalidatePath("/production");
  revalidatePath("/production/writers-room");
  revalidatePath("/production/film-queue");
  revalidatePath("/production/edit-bay");
  revalidatePath("/production/calendar");
}

export async function setProjectEditStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const editStatus = String(formData.get("editStatus"));
  if (!editStatuses.includes(editStatus as typeof editStatuses[number])) return;
  const { workspace } = await requireRole("EDITOR");
  await db.contentProject.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { editStatus, status: "editing" },
  });
  revalidatePath("/production/edit-bay");
}

export async function setProjectPublishDateAction(formData: FormData) {
  const id = String(formData.get("id"));
  const dateRaw = String(formData.get("publishDate") ?? "");
  const date = dateRaw ? new Date(dateRaw) : null;
  const { workspace } = await requireRole("EDITOR");
  await db.contentProject.updateMany({
    where: { id, channel: { workspaceId: workspace.id } },
    data: { publishDate: date },
  });
  revalidatePath("/production/calendar");
  revalidatePath("/production");
}

export async function assignProjectAction(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role") ?? "writer");
  const { workspace } = await requireRole("EDITOR");
  const ok = await db.contentProject.findFirst({ where: { id: projectId, channel: { workspaceId: workspace.id } } });
  if (!ok) return;
  await db.projectAssignee.upsert({
    where: { contentProjectId_userId_role: { contentProjectId: projectId, userId, role } },
    update: {},
    create: { contentProjectId: projectId, userId, role },
  });
  revalidatePath("/production");
}

// ── Tasks ─────────────────────────────────────────────────────────────────

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().optional(),
  contentProjectId: z.string().optional(),
});

export async function createTaskAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const parsed = taskSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    assigneeId: formData.get("assigneeId") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    contentProjectId: formData.get("contentProjectId") || undefined,
  });
  if (!parsed.success) return;
  await db.task.create({
    data: {
      workspaceId: workspace.id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigneeId: parsed.data.assigneeId ?? null,
      dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null,
      contentProjectId: parsed.data.contentProjectId ?? null,
    },
  });
  revalidatePath("/production/tasks");
}

export async function setTaskStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["todo", "in_progress", "done"].includes(status)) return;
  const { workspace } = await requireRole("EDITOR");
  await db.task.updateMany({ where: { id, workspaceId: workspace.id }, data: { status } });
  revalidatePath("/production/tasks");
}

// ── Assets ────────────────────────────────────────────────────────────────

export async function createAssetAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const channelId = formData.get("channelId") ? String(formData.get("channelId")) : null;
  const kind = String(formData.get("kind") ?? "link");
  const name = String(formData.get("name") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim() || null;
  if (!name) return;
  if (channelId) {
    const ok = await db.channel.findFirst({ where: { id: channelId, workspaceId: workspace.id } });
    if (!ok) return;
  }
  await db.asset.create({
    data: { channelId, kind, name, url, tags: writeJson([]) },
  });
  revalidatePath("/production/assets");
}

export async function toggleAssetFavoriteAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  const a = await db.asset.findFirst({ where: { id, OR: [{ channelId: null }, { channel: { workspaceId: workspace.id } }] } });
  if (!a) return;
  await db.asset.update({ where: { id: a.id }, data: { favorite: !a.favorite } });
  revalidatePath("/production/assets");
}

// ── Swipes ────────────────────────────────────────────────────────────────

export async function createSwipeAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const channelId = formData.get("channelId") ? String(formData.get("channelId")) : null;
  const imageUrl = String(formData.get("imageUrl") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim() || null;
  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "thumbnail");
  if (!imageUrl) return;
  await db.swipe.create({
    data: { workspaceId: workspace.id, channelId, imageUrl, title, sourceUrl, kind, tags: writeJson([]) },
  });
  revalidatePath("/production/swipes");
}

export async function removeSwipeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("EDITOR");
  await db.swipe.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/production/swipes");
}

// ── Wiki ──────────────────────────────────────────────────────────────────

export async function upsertWikiDocAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = formData.get("id") ? String(formData.get("id")) : null;
  const channelId = formData.get("channelId") ? String(formData.get("channelId")) : null;
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  if (!title) return;
  if (id) {
    await db.wikiDoc.updateMany({
      where: { id, workspaceId: workspace.id },
      data: { title, body, channelId },
    });
  } else {
    await db.wikiDoc.create({
      data: { workspaceId: workspace.id, channelId, title, body, checklist: writeJson([]) },
    });
  }
  revalidatePath("/production/wiki");
}
