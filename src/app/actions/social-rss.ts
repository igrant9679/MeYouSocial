"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { ownTopicId } from "@/lib/topics";
import { assertPublicUrl, fetchFeed, pollFeed } from "@/lib/social/rss";
import { storeWords } from "@/lib/social/rss-filter";

// RSS feeds (Socialmonials parity, phase 4, 2026-10-17). Following a feed
// reads it once on the spot, so a bad URL is refused now rather than failing
// silently on the next sweep.

function back(msg: { ok?: string; err?: string }): never {
  redirect(`/social/rss?${msg.ok ? `ok=${encodeURIComponent(msg.ok)}` : `err=${encodeURIComponent(msg.err ?? "")}`}`);
}

/**
 * The filters and defaults from a feed form (E-SOC-20): include and exclude
 * words, whether drafts take the item's picture, and the accounts drafts
 * target — narrowed to this workspace's connected accounts.
 */
async function feedOptions(workspaceId: string, formData: FormData) {
  const ids = [...new Set(formData.getAll("accountIds").map(String).filter(Boolean))].slice(0, 30);
  const accounts = ids.length ? await db.zernioAccount.findMany({ where: { id: { in: ids }, workspaceId, status: "connected" }, select: { id: true } }) : [];
  return {
    includeWords: storeWords(String(formData.get("includeWords") ?? "")),
    excludeWords: storeWords(String(formData.get("excludeWords") ?? "")),
    useImage: formData.get("useImage") === "on",
    accountIds: JSON.stringify(accounts.map((a) => a.id)),
  };
}

const skippedNote = (n: number | undefined) => (n ? ` ${n} skipped by the feed's words.` : "");

export async function addFeedAction(formData: FormData) {
  const { workspace, user } = await requireRole("EDITOR");
  const raw = String(formData.get("url") ?? "").trim().slice(0, 1000);
  const mode = String(formData.get("mode") ?? "ideas") === "drafts" ? "drafts" : "ideas";
  const topicId = await ownTopicId(workspace.id, formData.get("topicId"));
  const category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;
  let url: string;
  let title: string | null = null;
  try {
    url = (await assertPublicUrl(raw)).toString();
    const parsed = await fetchFeed(url);
    title = parsed.title;
    if (parsed.items.length === 0) back({ err: "That feed has no items to read." });
  } catch (e) {
    back({ err: e instanceof Error ? e.message : "Couldn't read that feed." });
  }
  const existing = await db.rssFeed.findFirst({ where: { workspaceId: workspace.id, url } });
  if (existing) back({ err: "This workspace already follows that feed." });
  const feed = await db.rssFeed.create({ data: { workspaceId: workspace.id, url, title, mode, topicId, category, createdById: user.id, ...(await feedOptions(workspace.id, formData)) } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "social.rss_followed", entityType: "rss_feed", entityId: feed.id, meta: { url, mode } });
  // First read now: at most 5 items from the last 7 days; the rest are marked seen.
  const r = await pollFeed(feed.id);
  revalidatePath("/social/rss");
  revalidatePath("/ideas", "layout");
  back({ ok: `Following ${title ?? url}. ${r.made ? `${r.made} recent item${r.made === 1 ? "" : "s"} became ${mode === "drafts" ? "drafts" : "ideas on the board"}` : "Nothing from the last week to bring in"}.${skippedNote(r.skipped)} New items arrive within the hour.` });
}

export async function toggleFeedAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const feed = await db.rssFeed.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!feed) back({ err: "That feed isn't followed here." });
  await db.rssFeed.update({ where: { id: feed.id }, data: { active: !feed.active } });
  revalidatePath("/social/rss");
  back({ ok: feed.active ? "Paused — nothing new is brought in until you resume it." : "Resumed." });
}

export async function updateFeedAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const mode = String(formData.get("mode") ?? "ideas") === "drafts" ? "drafts" : "ideas";
  const topicId = await ownTopicId(workspace.id, formData.get("topicId"));
  const category = String(formData.get("category") ?? "").trim().slice(0, 40) || null;
  const r = await db.rssFeed.updateMany({ where: { id, workspaceId: workspace.id }, data: { mode, topicId, category, ...(await feedOptions(workspace.id, formData)) } });
  revalidatePath("/social/rss");
  back(r.count ? { ok: "Saved." } : { err: "That feed isn't followed here." });
}

export async function checkFeedNowAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const feed = await db.rssFeed.findFirst({ where: { id, workspaceId: workspace.id }, select: { id: true, active: true, mode: true } });
  if (!feed) back({ err: "That feed isn't followed here." });
  if (!feed.active) back({ err: "That feed is paused — resume it first." });
  const r = await pollFeed(feed.id);
  revalidatePath("/social/rss");
  revalidatePath("/ideas", "layout");
  if (r.error) back({ err: `Couldn't read the feed: ${r.error}` });
  back({ ok: `${r.made ? `${r.made} new item${r.made === 1 ? "" : "s"} became ${feed.mode === "drafts" ? "drafts" : "ideas on the board"}.` : "Nothing new to bring in."}${skippedNote(r.skipped)}` });
}
