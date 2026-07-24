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

export async function createTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) back("Give the topic a name.", "err");
  const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

  const existing = await db.topic.findFirst({ where: { workspaceId: workspace.id, name } });
  if (existing) back(`“${name}” is already a topic.`, "err");

  await db.topic.create({
    data: { workspaceId: workspace.id, name, description, keywords: writeJson(keywords) },
  });
  revalidatePath("/brand");
  back("Topic added.");
}

export async function updateTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
  const keywords = String(formData.get("keywords") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  await db.topic.updateMany({
    where: { id, workspaceId: workspace.id },
    data: { description, keywords: writeJson(keywords) },
  });
  revalidatePath("/brand");
  back("Topic updated.");
}

export async function toggleTopicStatusAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  const topic = await db.topic.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!topic) back("Not found.", "err");
  await db.topic.update({
    where: { id: topic.id },
    data: { status: topic.status === "active" ? "archived" : "active" },
  });
  revalidatePath("/brand");
  back(topic.status === "active" ? "Topic archived." : "Topic reactivated.");
}

export async function deleteTopicAction(formData: FormData) {
  const { workspace } = await requireRole("EDITOR");
  const id = String(formData.get("id") ?? "");
  await db.topic.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/brand");
  back("Topic deleted.");
}
