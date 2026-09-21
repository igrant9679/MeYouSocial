"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeJson } from "@/lib/db/json";

// Actions for the workspace Brand hub (/brand). Everything here is
// workspace-scoped — each company's identity is its own.

// Declared (not a const arrow) so TS narrows on its `never` return.
function back(msg: string, kind: "ok" | "err" = "ok"): never {
  redirect(`/brand?${kind}=${encodeURIComponent(msg)}`);
}

/**
 * Brand identity: colors, fonts, logo URL, footer credit.
 *
 * Deliberately a FOCUSED update rather than reusing saveBrandKitAction — that
 * one reads the entire brand form (image dimensions, render profile, and the
 * FR-8 asset-policy booleans) and would reset every field this page doesn't
 * render, silently turning off requireImagesToPublish.
 */
export async function saveBrandIdentityAction(formData: FormData) {
  const { workspace } = await requireRole("ADMIN");
  const str = (k: string, max = 200) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? v.slice(0, max) : null;
  };
  const hex = (k: string) => {
    const v = str(k, 32);
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) back(`${k} must be a 6-digit hex colour like #2563EB.`, "err");
    return v;
  };
  const data = {
    primaryColor: hex("primaryColor"),
    secondaryColor: hex("secondaryColor"),
    accentColor: hex("accentColor"),
    headingFont: str("headingFont", 80),
    bodyFont: str("bodyFont", 80),
    logoUrl: str("logoUrl", 500),
    footerCredit: str("footerCredit", 300),
  };
  await db.brandKit.upsert({
    where: { workspaceId: workspace.id },
    update: data,
    create: { workspaceId: workspace.id, ...data },
  });
  revalidatePath("/brand");
  back("Brand identity saved.");
}

// ── Topics ───────────────────────────────────────────────────────────────────
//
// Topics live under Ideas since 2026-09-21 ("Topics as the spine"): the
// management tab is /ideas/topics and each Topic has its own page. These
// actions stayed in this file because their callers import from here; only
// where they SEND you changed. `back` names where the form was, and is held
// to the two places a Topic form can be.

function topicRevalidate() {
  revalidatePath("/ideas", "layout");
  revalidatePath("/brand");
}
function topicBack(formData: FormData, msg: string, kind: "ok" | "err" = "ok", opts?: { deleted?: boolean }): never {
  const raw = String(formData.get("back") ?? "/ideas/topics");
  // The places a Topic form can be: the Topics tab and page, Brand's
  // pointer, and the two Research surfaces that suggest one.
  let to = /^\/(ideas|brand|blog\/keywords|research)(\/|$)/.test(raw) ? raw.split("?")[0] : "/ideas/topics";
  // A deleted Topic's own page no longer exists.
  if (opts?.deleted && /^\/ideas\/topics\/.+/.test(to)) to = "/ideas/topics";
  redirect(`${to}?${kind}=${encodeURIComponent(msg)}`);
}

export async function createTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) topicBack(formData, "Give the topic a name.", "err");
  const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

  const existing = await db.topic.findFirst({ where: { workspaceId: workspace.id, name } });
  if (existing) topicBack(formData, `“${name}” is already a topic.`, "err");

  await db.topic.create({
    data: { workspaceId: workspace.id, name, description, keywords: writeJson(keywords) },
  });
  topicRevalidate();
  topicBack(formData, "Topic added.");
}
export async function updateTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  // Every field is optional so a small form (the per-Topic page's priority
  // control) can send just the one it owns. A field that is ABSENT leaves the
  // stored value alone; one that is PRESENT and empty is a deliberate clear.
  const rawDescription = formData.get("description");
  const description = rawDescription == null ? undefined : String(rawDescription).trim().slice(0, 500) || null;
  const rawKeywords = formData.get("keywords");
  const keywords =
    rawKeywords == null
      ? undefined
      : writeJson(String(rawKeywords).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30));
  // Priority is the one field the recommendation engine writes on its own
  // (`topic.raise_priority` sets it to 10), and its success message points here
  // to undo that — so this form is the only way back down. A missing field
  // leaves the stored value alone rather than silently zeroing it; an empty one
  // is a deliberate reset to 0.
  const rawPriority = formData.get("priority");
  const priority =
    rawPriority == null ? undefined : Math.max(0, Math.min(10, Math.round(Number(rawPriority) || 0)));

  await db.topic.updateMany({
    where: { id, workspaceId: workspace.id },
    data: {
      ...(description === undefined ? {} : { description }),
      ...(keywords === undefined ? {} : { keywords }),
      ...(priority === undefined ? {} : { priority }),
    },
  });
  topicRevalidate();
  topicBack(formData, "Topic updated.");
}
export async function toggleTopicStatusAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const topic = await db.topic.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!topic) topicBack(formData, "Not found.", "err");
  await db.topic.update({
    where: { id: topic.id },
    data: { status: topic.status === "active" ? "archived" : "active" },
  });
  topicRevalidate();
  topicBack(formData, topic.status === "active" ? "Topic archived." : "Topic reactivated.");
}
export async function deleteTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  await db.topic.deleteMany({ where: { id, workspaceId: workspace.id } });
  topicRevalidate();
  topicBack(formData, "Topic deleted.", "ok", { deleted: true });
}

/**
 * A suggested Topic (a keyword cluster that is not a Topic yet) the person
 * decided against. Remembered per workspace in `topics:dismissed_suggestions`
 * so /ideas/topics stops offering it; adding a Topic by that name later is
 * still allowed.
 */
export async function dismissTopicSuggestionAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) topicBack(formData, "Nothing to discard.", "err");
  const { getSetting, setWorkspaceSetting } = await import("@/lib/settings");
  let list: string[] = [];
  try { list = JSON.parse((await getSetting("topics:dismissed_suggestions", workspace.id).catch(() => "")) || "[]"); } catch { list = []; }
  if (!list.includes(name)) list.push(name);
  await setWorkspaceSetting(workspace.id, "topics:dismissed_suggestions", JSON.stringify(list.slice(-100)));
  topicRevalidate();
  topicBack(formData, `“${name}” won't be suggested again.`);
}
