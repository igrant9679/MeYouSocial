"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { NOTE_MAX } from "@/lib/chart-annotations";
import { getPostingTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/social/slots";

const back = (kind: "ok" | "err", text: string) => redirect(`/measure?${kind}=${encodeURIComponent(text)}#chart-notes`);

/**
 * An editor's note on a day (E-MEA-04) — drawn on every chart of the workspace
 * that spans it. The day is read in the posting timezone and stored as its
 * midnight there, so a note made in London for "3 Nov" lands on New York's 3 Nov.
 */
export async function addChartNoteAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const text = String(formData.get("text") ?? "").replace(/\s+/g, " ").trim();
  const day = String(formData.get("day") ?? "").trim();
  if (!text) back("err", "Write what happened — the note was empty.");
  if (text.length > NOTE_MAX) back("err", `A note is at most ${NOTE_MAX} characters — this one is ${text.length}.`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) back("err", "Pick the day the note is about.");
  const [y, mo, d] = [Number(m![1]), Number(m![2]), Number(m![3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || y < 2000) back("err", "That isn't a real day.");
  const tz = await getPostingTimeZone(workspace.id).catch(() => "UTC");
  const at = zonedTimeToUtc(y, mo, d, 0, 0, tz);
  // A day after today in the posting zone isn't something that happened yet.
  const today = zonedParts(new Date(), tz);
  if (at.getTime() > zonedTimeToUtc(today.year, today.month, today.day, 0, 0, tz).getTime()) back("err", "Notes mark what happened — pick today or an earlier day.");
  const note = await db.chartNote.create({ data: { workspaceId: workspace.id, at, text, createdById: user.id }, select: { id: true } });
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "chart_note.added", entityType: "chart_note", entityId: note.id, meta: { day, text } });
  revalidatePath("/measure");
  revalidatePath("/blog/report");
  // Search charts end at the latest reading, which trails by a couple of days.
  const recent = Date.now() - at.getTime() < 3 * 86_400_000;
  back("ok", `Note added for ${day} — it shows on every chart that spans that day.${recent ? " Search numbers trail by a couple of days, so the charts reach it when that day's readings arrive." : ""}`);
}
