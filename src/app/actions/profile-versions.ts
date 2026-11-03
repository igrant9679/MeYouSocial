"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { readJson, writeJson } from "@/lib/db/json";
import { AUDIENCE_SECTIONS, audienceSnapshot, saveVersion, voiceSnapshot, type Snapshot } from "@/lib/profile-versions";

/**
 * Bring an earlier version of a voice profile or an audience avatar back
 * (E-SET-07). The restore is itself a change, so it leaves a version too —
 * "Restored version 2" — and can be undone the same way.
 */
export async function restoreProfileVersionAction(formData: FormData) {
  const id = String(formData.get("versionId") ?? "");
  const { workspace, user } = await requireRole("EDITOR");
  const v = await db.profileVersion.findFirst({ where: { id, channel: { workspaceId: workspace.id } } });
  if (!v) redirect("/channels");
  const n = await db.profileVersion.count({ where: { kind: v.kind, profileId: v.profileId, createdAt: { lte: v.createdAt } } });
  const snap = readJson<Snapshot>(v.snapshot, {});
  const label = `Restored version ${n}`;

  if (v.kind === "voice") {
    const p = await db.voiceProfile.findFirst({ where: { id: v.profileId, channelId: v.channelId } });
    if (!p) redirect(`/channels/${v.channelId}/voice?err=${encodeURIComponent("That voice profile is gone.")}`);
    // The page's scratch notes stay; the voice itself is the version's.
    const scratch = Object.fromEntries(Object.entries(readJson<Record<string, unknown>>(p.data, {})).filter(([k]) => k.startsWith("_")));
    const before = voiceSnapshot(p.data);
    await db.voiceProfile.update({ where: { id: p.id }, data: { data: writeJson({ ...snap, ...scratch }) } });
    await saveVersion({ kind: "voice", profileId: p.id, channelId: v.channelId, snapshot: snap, label, userId: user.id, before });
    revalidatePath(`/channels/${v.channelId}/voice`);
    redirect(`/channels/${v.channelId}/voice?profile=${p.id}&ok=${encodeURIComponent(`${label}.`)}`);
  }

  const a = await db.audienceAvatar.findFirst({ where: { id: v.profileId, channelId: v.channelId } });
  if (!a) redirect(`/channels/${v.channelId}/audience?err=${encodeURIComponent("That audience avatar is gone.")}`);
  const before = audienceSnapshot(a);
  const data = Object.fromEntries(AUDIENCE_SECTIONS.map((k) => [k, writeJson(snap[k] ?? (k === "keyQuestions" ? [] : {}))]));
  await db.audienceAvatar.update({ where: { id: a.id }, data });
  await saveVersion({ kind: "audience", profileId: a.id, channelId: v.channelId, snapshot: audienceSnapshot(data), label, userId: user.id, before });
  revalidatePath(`/channels/${v.channelId}/audience`);
  redirect(`/channels/${v.channelId}/audience?ok=${encodeURIComponent(`${label}.`)}`);
}
