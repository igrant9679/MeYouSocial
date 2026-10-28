"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { ownTopicId } from "@/lib/topics";
import { isIdeaFormat, type IdeaFormat } from "@/lib/ideas-board";

// E-IDE-01: one round trip for many cards. Weekly triage of forty ideas was
// forty page loads. Each table keeps its own rules — the open states its card's
// buttons allow — so a bulk press can't do what no single button could (approve
// a drafted idea into a second article, reject a video that has a script).

const MAX = 200;
const OPS = ["approve", "reject", "topic", "delete"] as const;
type Op = (typeof OPS)[number];

// Which statuses each op may move FROM, per table, and what it writes.
const RULES: Record<IdeaFormat, { approve: { from: string[]; to: string }; reject: { from: string[]; to: string }; open: string[] }> = {
  article: { approve: { from: ["discovered", "rejected"], to: "approved" }, reject: { from: ["discovered", "approved"], to: "rejected" }, open: ["discovered", "approved", "rejected"] },
  video: { approve: { from: ["new", "archived"], to: "approved" }, reject: { from: ["new", "approved"], to: "archived" }, open: ["new", "approved", "archived"] },
  social: { approve: { from: ["discovered", "rejected"], to: "approved" }, reject: { from: ["discovered", "approved"], to: "rejected" }, open: ["discovered", "approved", "rejected"] },
};

/** Back to the board view the person was on (its filters kept), with a message. Held to /ideas. */
function backWith(back: string, kind: "ok" | "err", msg: string): never {
  const u = new URL(back.startsWith("/ideas") && !back.startsWith("//") ? back : "/ideas", "http://board.local");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  u.searchParams.set(kind, msg);
  redirect(u.pathname + u.search);
}

/** `sel` values are "<format>:<id>"; duplicates and anything malformed are dropped. */
function selection(values: FormDataEntryValue[]): Record<IdeaFormat, string[]> & { total: number } {
  const out: Record<IdeaFormat, Set<string>> = { article: new Set(), video: new Set(), social: new Set() };
  let total = 0;
  for (const v of values) {
    if (total >= MAX) break;
    const [format, id] = String(v).split(":");
    if (!isIdeaFormat(format) || !id || out[format].has(id)) continue;
    out[format].add(id);
    total++;
  }
  return { article: [...out.article], video: [...out.video], social: [...out.social], total };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function bulkIdeasAction(formData: FormData) {
  const back = String(formData.get("back") ?? "/ideas");
  const op = String(formData.get("op") ?? "") as Op;
  const { user, workspace } = await requireRole("EDITOR");
  const ws = workspace.id;
  if (!OPS.includes(op)) backWith(back, "err", "Choose what to do with the selected ideas.");
  const sel = selection(formData.getAll("sel"));
  if (sel.total === 0) backWith(back, "err", "Select at least one idea first — tick its box, or press x on it.");

  if (op === "topic") {
    const raw = String(formData.get("topicId") ?? "").trim();
    if (!raw) backWith(back, "err", "Choose the Topic to tag them with.");
    const topicId = raw === "none" ? null : await ownTopicId(ws, raw);
    if (raw !== "none" && !topicId) backWith(back, "err", "That Topic isn't in this workspace any more.");
    const a = sel.article.length ? (await db.blogIdea.updateMany({ where: { id: { in: sel.article }, workspaceId: ws }, data: { topicId } })).count : 0;
    const s = sel.social.length ? (await db.socialIdea.updateMany({ where: { id: { in: sel.social }, workspaceId: ws }, data: { topicId } })).count : 0;
    const v = sel.video.length ? (await db.idea.updateMany({ where: { id: { in: sel.video }, channel: { workspaceId: ws } }, data: { topicId } })).count : 0;
    const name = topicId ? (await db.topic.findFirst({ where: { id: topicId }, select: { name: true } }))?.name : null;
    revalidatePath("/ideas", "layout");
    backWith(back, "ok", topicId ? `${plural(a + s + v, "idea")} tagged “${name}”.` : `${plural(a + s + v, "idea")} moved to “No topic yet”.`);
  }

  if (op === "delete") {
    // The toolbar asks first; a request without its "yes" deletes nothing.
    if (formData.get("confirm") !== "yes") backWith(back, "err", "Nothing was deleted — confirm the delete first.");
    const [arts, vids, socs] = await Promise.all([
      db.blogIdea.findMany({ where: { id: { in: sel.article }, workspaceId: ws, status: { in: RULES.article.open } }, select: { id: true, title: true } }),
      db.idea.findMany({ where: { id: { in: sel.video }, channel: { workspaceId: ws }, status: { in: RULES.video.open } }, select: { id: true, title: true } }),
      db.socialIdea.findMany({ where: { id: { in: sel.social }, workspaceId: ws, status: { in: RULES.social.open } }, select: { id: true, hook: true } }),
    ]);
    if (arts.length) await db.blogIdea.deleteMany({ where: { id: { in: arts.map((r) => r.id) }, workspaceId: ws, status: { in: RULES.article.open } } });
    if (vids.length) await db.idea.deleteMany({ where: { id: { in: vids.map((r) => r.id) }, channel: { workspaceId: ws }, status: { in: RULES.video.open } } });
    if (socs.length) await db.socialIdea.deleteMany({ where: { id: { in: socs.map((r) => r.id) }, workspaceId: ws, status: { in: RULES.social.open } } });
    const n = arts.length + vids.length + socs.length;
    if (n) {
      await writeAudit({
        workspaceId: ws,
        actorId: user.id,
        action: "ideas.bulk_deleted",
        entityType: "idea",
        meta: {
          articles: arts.length, videos: vids.length, social: socs.length,
          titles: [...arts.map((r) => r.title), ...vids.map((r) => r.title), ...socs.map((r) => r.hook.slice(0, 80))].slice(0, 25),
        },
      });
    }
    revalidatePath("/ideas", "layout");
    revalidatePath("/blog");
    const kept = sel.total - n;
    backWith(back, "ok", `${plural(n, "idea")} deleted.${kept ? ` ${plural(kept, "idea was", "ideas were")} already made and kept.` : ""}`);
  }

  // Approve or reject: only rows in a state the op may move from, claimed in
  // the same conditional update, each recorded like its card's button.
  const which = op as "approve" | "reject";
  let changed = 0;

  if (sel.article.length) {
    const { from, to } = RULES.article[which];
    const rows = await db.blogIdea.findMany({ where: { id: { in: sel.article }, workspaceId: ws, status: { in: from } }, select: { id: true, status: true, title: true } });
    if (rows.length) {
      changed += (await db.blogIdea.updateMany({ where: { id: { in: rows.map((r) => r.id) }, workspaceId: ws, status: { in: from } }, data: { status: to } })).count;
      for (const r of rows) {
        await writeAudit({ workspaceId: ws, actorId: user.id, action: to === "approved" ? "ideas.approved" : "ideas.rejected", entityType: "blog_idea", entityId: r.id, meta: { from: r.status, title: r.title, bulk: true } });
      }
    }
  }

  if (sel.video.length) {
    const { from, to } = RULES.video[which];
    const rows = await db.idea.findMany({ where: { id: { in: sel.video }, channel: { workspaceId: ws }, status: { in: from } }, select: { id: true, status: true, title: true, channelId: true } });
    if (rows.length) {
      changed += (await db.idea.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: { in: from } }, data: { status: to } })).count;
      for (const r of rows) {
        await writeAudit({ workspaceId: ws, actorId: user.id, action: to === "approved" ? "ideas.approved" : "ideas.rejected", entityType: "video_idea", entityId: r.id, meta: { from: r.status, to, title: r.title, bulk: true } });
      }
      for (const channelId of new Set(rows.map((r) => r.channelId))) revalidatePath(`/channels/${channelId}`);
    }
  }

  if (sel.social.length) {
    const { from, to } = RULES.social[which];
    const rows = await db.socialIdea.findMany({ where: { id: { in: sel.social }, workspaceId: ws, status: { in: from } }, select: { id: true } });
    if (rows.length) {
      changed += (await db.socialIdea.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, workspaceId: ws, status: { in: from } },
        data: { status: to, ...(to === "approved" ? { approvedAt: new Date() } : {}) },
      })).count;
      for (const r of rows) {
        await writeAudit({ workspaceId: ws, actorId: user.id, action: to === "approved" ? "social.idea_approved" : "social.idea_rejected", entityType: "social_idea", entityId: r.id, meta: { bulk: true } });
      }
    }
  }

  revalidatePath("/ideas", "layout");
  revalidatePath("/blog");
  const skipped = sel.total - changed;
  const done = which === "approve" ? "approved" : "rejected";
  backWith(back, "ok", `${plural(changed, "idea")} ${done}.${skipped ? ` ${plural(skipped, "was", "were")} left as ${skipped === 1 ? "it was" : "they were"} — already ${done} or already made.` : ""}`);
}
