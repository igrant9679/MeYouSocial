import { db } from "@/lib/db";
import { notify } from "@/lib/notify";

/**
 * Auto-created production tasks — pipeline events become work items so nothing
 * waits in silence. Rules are workspace-configurable (Setting
 * `production:autotasks`, edited on the Tasks page), and every auto-task is
 * deduped against open tasks with the same title so retry loops can't spam the
 * board.
 *
 * Assignment is deliberately conservative: the post's reviewer or author when
 * one exists, else the first admin — never a guess between peers.
 */

export type AutoTaskRules = {
  reviewTask: boolean;     // post reaches draft_review → task for the reviewer
  assetTask: boolean;      // post reaches final approval missing images → task
  renderFailTask: boolean; // video render failed → task
  wipLimit: number;        // in-progress column limit on the task board
};

export const DEFAULT_AUTO_RULES: AutoTaskRules = {
  reviewTask: true,
  assetTask: true,
  renderFailTask: true,
  wipLimit: 5,
};

export async function getAutoTaskRules(): Promise<AutoTaskRules> {
  try {
    const row = await db.setting.findUnique({ where: { key: "production:autotasks" } });
    if (!row) return { ...DEFAULT_AUTO_RULES };
    const raw = JSON.parse(row.value) as Partial<AutoTaskRules>;
    const wip = Number(raw.wipLimit);
    return {
      reviewTask: raw.reviewTask !== false,
      assetTask: raw.assetTask !== false,
      renderFailTask: raw.renderFailTask !== false,
      wipLimit: Number.isFinite(wip) && wip >= 1 && wip <= 20 ? Math.round(wip) : DEFAULT_AUTO_RULES.wipLimit,
    };
  } catch {
    return { ...DEFAULT_AUTO_RULES };
  }
}

async function firstAdmin(workspaceId: string): Promise<string | null> {
  const admin = await db.membership.findFirst({
    where: { workspaceId, role: "ADMIN", status: "active" },
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  return admin?.userId ?? null;
}

/** Create the task unless an open one with this exact title already exists. */
async function createUnlessOpen(params: {
  workspaceId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueInDays?: number;
}): Promise<boolean> {
  const exists = await db.task.count({
    where: { workspaceId: params.workspaceId, title: params.title, status: { not: "done" } },
  });
  if (exists) return false;
  const dueDate = params.dueInDays ? new Date(Date.now() + params.dueInDays * 86400000) : null;
  await db.task.create({
    data: {
      workspaceId: params.workspaceId,
      title: params.title.slice(0, 200),
      description: params.description.slice(0, 1000),
      assigneeId: params.assigneeId,
      dueDate,
    },
  });
  if (params.assigneeId) {
    await notify({
      workspaceId: params.workspaceId,
      kind: "assigned",
      title: params.title,
      body: params.description.slice(0, 200),
      path: "/production/tasks",
      entityType: "task",
      userIds: [params.assigneeId],
    });
  }
  return true;
}

/** Post entered draft_review → the reviewer owns reading it. */
export async function autoTaskForReview(workspaceId: string, post: { id: string; title: string; reviewerId: string | null }) {
  const rules = await getAutoTaskRules();
  if (!rules.reviewTask) return;
  const assignee = post.reviewerId ?? (await firstAdmin(workspaceId));
  await createUnlessOpen({
    workspaceId,
    title: `Review: ${post.title}`,
    description: `The draft is parked at review. Open it at /blog/${post.id}?tab=review — checks, citations and comments are all on that tab.`,
    assigneeId: assignee,
    dueInDays: 2,
  });
}

/** Post reached final approval but the image gate would block it. */
export async function autoTaskForAssets(
  workspaceId: string,
  post: { id: string; title: string; createdById: string | null; reviewerId: string | null },
) {
  const rules = await getAutoTaskRules();
  if (!rules.assetTask) return;
  const assignee = post.createdById ?? post.reviewerId ?? (await firstAdmin(workspaceId));
  await createUnlessOpen({
    workspaceId,
    title: `Images needed: ${post.title}`,
    description: `Publishing is blocked until the featured and OG images are attached and approved. Fix at /blog/${post.id}?tab=assets.`,
    assigneeId: assignee,
    dueInDays: 1,
  });
}

/** A render failed — someone should look before the retry loop burns budget. */
export async function autoTaskForRenderFailure(workspaceId: string, render: { id: string; title: string; error?: string | null }) {
  const rules = await getAutoTaskRules();
  if (!rules.renderFailTask) return;
  await createUnlessOpen({
    workspaceId,
    title: `Render failed: ${render.title}`,
    description: `${render.error ?? "Provider error"} — inspect and retry at /videos/${render.id}.`,
    assigneeId: await firstAdmin(workspaceId),
    dueInDays: 1,
  });
}
