"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";

/**
 * Merge a duplicate social or video idea into another of its format (E-IDE-03;
 * article ideas have their own merge in actions/blog-ideas.ts). The one kept
 * gains the other's angle; the one folded in leaves the board the way that
 * format leaves it — a social idea is rejected as a duplicate (so discovery
 * steers away from proposing it again), a video idea is archived — and the
 * audit row says which went where. Editors; both ideas this workspace's and open.
 */

const OPEN_SOCIAL = ["discovered", "approved"];
const OPEN_VIDEO = ["new", "approved"];

function back(formData: FormData, key: "ok" | "err", text: string): never {
  const raw = String(formData.get("back") ?? "");
  const base = raw.startsWith("/ideas") ? raw.replace(/[?&](ok|err)=[^&]*/g, "") : "/ideas";
  redirect(`${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`);
}

export async function mergeDuplicateIdeaAction(formData: FormData) {
  const format = String(formData.get("format") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const targetId = String(formData.get("targetId") ?? "");
  if (!sourceId || !targetId || sourceId === targetId) back(formData, "err", "Choose the idea to merge this one into.");
  const { workspace, user } = await requireRole("EDITOR");

  if (format === "social") {
    const [source, target] = await Promise.all([
      db.socialIdea.findFirst({ where: { id: sourceId, workspaceId: workspace.id } }),
      db.socialIdea.findFirst({ where: { id: targetId, workspaceId: workspace.id } }),
    ]);
    if (!source || !target || !OPEN_SOCIAL.includes(source.status) || !OPEN_SOCIAL.includes(target.status)) back(formData, "err", "That merge isn't possible any more — one of the ideas has moved on.");
    const angle = [target.angle, source.angle && source.angle !== target.angle ? source.angle : null].filter(Boolean).join(" ").slice(0, 500) || null;
    await db.socialIdea.update({ where: { id: target.id }, data: { angle, topicId: target.topicId ?? source.topicId } });
    await db.socialIdea.update({ where: { id: source.id }, data: { status: "rejected", rejectReason: "duplicate" } });
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ideas.merged", entityType: "social_idea", entityId: target.id, meta: { format, mergedFrom: source.id } });
    revalidatePath("/ideas");
    back(formData, "ok", `Merged into “${target.hook.slice(0, 80)}” — the other is rejected as a duplicate.`);
  }

  if (format === "video") {
    const [source, target] = await Promise.all([
      db.idea.findFirst({ where: { id: sourceId, channel: { workspaceId: workspace.id } } }),
      db.idea.findFirst({ where: { id: targetId, channel: { workspaceId: workspace.id } } }),
    ]);
    // In progress means someone is scripting it — that one isn't folded away under them.
    if (!source || !target || !OPEN_VIDEO.includes(source.status) || ![...OPEN_VIDEO, "in_progress"].includes(target.status)) back(formData, "err", "That merge isn't possible any more — one of the ideas has moved on.");
    const strategy = [target.strategy, source.strategy && source.strategy !== target.strategy ? source.strategy : null].filter(Boolean).join(" ").slice(0, 1000) || null;
    await db.idea.update({ where: { id: target.id }, data: { strategy, topicId: target.topicId ?? source.topicId } });
    await db.idea.update({ where: { id: source.id }, data: { status: "archived" } });
    await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ideas.merged", entityType: "idea", entityId: target.id, meta: { format, mergedFrom: source.id } });
    revalidatePath("/ideas");
    back(formData, "ok", `Merged into “${target.title.slice(0, 80)}” — the other is archived.`);
  }

  back(formData, "err", "Only social and video ideas merge here.");
}
