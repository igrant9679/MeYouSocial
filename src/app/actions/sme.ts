"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { llm } from "@/lib/llm";
import { isGloballyPaused, writeAudit } from "@/lib/governance";
import { INTAKE_QUESTIONS, parseAnswers, readAnswers } from "@/lib/sme";

/**
 * FR-3 — SME profile intake. Every save snapshots the previous version: an
 * expert's stated view changes over time, and a draft that leaned on the old
 * one should stay explainable.
 */

const PATH = "/blog/experts";

const str = (fd: FormData, k: string, max = 2000) => {
  const v = String(fd.get(k) ?? "").trim();
  return v ? v.slice(0, max) : null;
};

export async function createSmeProfileAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const { workspace } = await requireRole("EDITOR");
  const profile = await db.smeProfile.create({
    data: {
      workspaceId: workspace.id,
      name: name.slice(0, 120),
      role: str(formData, "role", 120),
    },
  });
  revalidatePath(PATH);
  redirect(`${PATH}/${profile.id}`);
}

export async function saveSmeProfileAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { user, workspace } = await requireRole("EDITOR");
  const current = await db.smeProfile.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!current) return;

  const topics = JSON.stringify(
    String(formData.get("topics") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 24),
  );
  const next = {
    name: String(formData.get("name") ?? "").trim().slice(0, 120) || current.name,
    role: str(formData, "role", 120),
    credentials: str(formData, "credentials", 1000),
    bio: str(formData, "bio", 2000),
    answers: JSON.stringify(readAnswers(formData)),
    alwaysSay: str(formData, "alwaysSay", 2000),
    neverSay: str(formData, "neverSay", 2000),
    topics,
  };

  // Snapshot only when something actually changed.
  const changed = (Object.keys(next) as Array<keyof typeof next>).some((k) => next[k] !== current[k]);
  if (changed) {
    await db.smeProfileVersion.create({
      data: {
        profileId: current.id,
        version: current.version,
        data: JSON.stringify({
          name: current.name,
          role: current.role,
          credentials: current.credentials,
          bio: current.bio,
          answers: current.answers,
          alwaysSay: current.alwaysSay,
          neverSay: current.neverSay,
          topics: current.topics,
        }),
        editedById: user.id,
      },
    });
    await db.smeProfile.update({
      where: { id: current.id },
      data: { ...next, version: current.version + 1 },
    });
    await writeAudit({
      workspaceId: workspace.id,
      actorId: user.id,
      action: "sme.profile_saved",
      entityType: "sme_profile",
      entityId: current.id,
      meta: { version: current.version + 1 },
    });
  }
  revalidatePath(`${PATH}/${id}`);
  revalidatePath(PATH);
}

export async function setSmeStatusAction(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) === "archived" ? "archived" : "active";
  const { workspace } = await requireRole("EDITOR");
  await db.smeProfile.updateMany({ where: { id, workspaceId: workspace.id }, data: { status } });
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
}

export async function deleteSmeProfileAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { workspace } = await requireRole("ADMIN");
  await db.smeProfile.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath(PATH);
  redirect(PATH);
}

export async function restoreSmeVersionAction(formData: FormData) {
  const versionId = String(formData.get("versionId"));
  const { user, workspace } = await requireRole("EDITOR");
  const version = await db.smeProfileVersion.findFirst({
    where: { id: versionId, profile: { workspaceId: workspace.id } },
    include: { profile: true },
  });
  if (!version) return;
  let payload: Record<string, string | null> = {};
  try {
    payload = JSON.parse(version.data) as Record<string, string | null>;
  } catch {
    return;
  }
  const p = version.profile;
  await db.smeProfileVersion.create({
    data: {
      profileId: p.id,
      version: p.version,
      data: JSON.stringify({
        name: p.name,
        role: p.role,
        credentials: p.credentials,
        bio: p.bio,
        answers: p.answers,
        alwaysSay: p.alwaysSay,
        neverSay: p.neverSay,
        topics: p.topics,
      }),
      editedById: user.id,
    },
  });
  await db.smeProfile.update({
    where: { id: p.id },
    data: {
      name: payload.name ?? p.name,
      role: payload.role ?? null,
      credentials: payload.credentials ?? null,
      bio: payload.bio ?? null,
      answers: payload.answers ?? "{}",
      alwaysSay: payload.alwaysSay ?? null,
      neverSay: payload.neverSay ?? null,
      topics: payload.topics ?? "[]",
      version: p.version + 1,
    },
  });
  revalidatePath(`${PATH}/${p.id}`);
}

/**
 * Seed draft answers from existing material — a services page, a portfolio, a
 * prior article (FR-3). The output is explicitly a *draft* the expert corrects:
 * extraction can only surface what the source says, and a source rarely states
 * an expert's contested opinions.
 */
export async function seedSmeFromSourceAction(formData: FormData) {
  const id = String(formData.get("id"));
  const url = String(formData.get("sourceUrl") ?? "").trim();
  const pasted = String(formData.get("sourceText") ?? "").trim();
  const { workspace } = await requireRole("EDITOR");
  if (await isGloballyPaused(workspace.id)) return;
  const profile = await db.smeProfile.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!profile) return;

  let source = pasted;
  if (!source && /^https?:\/\//i.test(url)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
      if (res.ok) {
        const html = await res.text();
        source = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    } catch {
      source = "";
    }
  }
  if (source.length < 200) return;

  const existing = parseAnswers(profile.answers);
  const system =
    "You extract an expert's knowledge from source material they wrote or that describes their work. " +
    'Respond ONLY with a JSON object keyed by question id: {"<id>": "<answer>"}. ' +
    "Use ONLY what the source actually supports — omit a key entirely rather than guessing at it. " +
    "Never invent credentials, years of experience, client names, or outcomes. Write in the expert's own register.";
  const prompt = [
    "Questions to answer where the source supports it:",
    INTAKE_QUESTIONS.map((q) => `${q.id}: ${q.question} (${q.hint})`).join("\n"),
    Object.keys(existing).length
      ? `Already answered (do NOT overwrite these — omit them): ${Object.keys(existing).join(", ")}`
      : null,
    `Source material:\n${source.slice(0, 12000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await llm.complete({
    model: llm.defaultModel,
    system,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 2500,
    workspaceId: workspace.id,
  });
  let extracted: Record<string, unknown> = {};
  try {
    const m = res.content.match(/\{[\s\S]*\}/);
    extracted = m ? (JSON.parse(m[0]) as Record<string, unknown>) : {};
  } catch {
    extracted = {};
  }

  // Never overwrite what the expert wrote themselves.
  const merged = { ...existing };
  let added = 0;
  for (const q of INTAKE_QUESTIONS) {
    const v = extracted[q.id];
    if (!existing[q.id] && typeof v === "string" && v.trim().length > 20) {
      merged[q.id] = v.trim().slice(0, 4000);
      added++;
    }
  }
  if (!added) return;

  await db.smeProfile.update({ where: { id: profile.id }, data: { answers: JSON.stringify(merged) } });
  await writeAudit({
    workspaceId: workspace.id,
    action: "sme.seeded_from_source",
    entityType: "sme_profile",
    entityId: profile.id,
    meta: { added, from: pasted ? "pasted text" : url },
  });
  revalidatePath(`${PATH}/${id}`);
}
