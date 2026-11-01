"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/acl";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/governance";
import { csvRecords } from "@/lib/csv";
import { cleanTitle } from "@/lib/list-marker";

/**
 * Import article ideas or keywords from a CSV (E-IDE-24) — the export's own
 * columns, so a sheet can make the round trip. Ideas arrive as Discovered
 * (approval stays a person's call on the board); a Topic is matched by name;
 * a row that duplicates an idea or keyword already here is skipped.
 */
const MAX_ROWS = 500;
const MAX_BYTES = 1_000_000;

function back(kind: string, q: string): never {
  redirect(`${kind === "keywords" ? "/blog/keywords" : "/ideas"}?${q}`);
}

export async function importIdeasCsvAction(formData: FormData) {
  const { user, workspace } = await requireRole("EDITOR");
  const kind = formData.get("kind") === "keywords" ? "keywords" : "articles";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(kind, "flashErr=" + encodeURIComponent("Choose a CSV file to import."));
  if ((file as File).size > MAX_BYTES) back(kind, "flashErr=" + encodeURIComponent("That file is over 1 MB — split it into smaller ones."));
  const { header, records } = csvRecords(await (file as File).text());
  const need = kind === "keywords" ? "phrase" : "title";
  if (!header.includes(need)) back(kind, "flashErr=" + encodeURIComponent(`The first row must name the columns, with a "${need}" column — the export's own file works as a template.`));
  if (records.length > MAX_ROWS) back(kind, "flashErr=" + encodeURIComponent(`${records.length} rows — import up to ${MAX_ROWS} at a time.`));

  let added = 0, dupes = 0, blank = 0;
  const unknownTopics = new Set<string>();
  if (kind === "keywords") {
    const have = new Set((await db.keyword.findMany({ where: { workspaceId: workspace.id }, select: { phrase: true } })).map((k) => k.phrase.toLowerCase()));
    for (const r of records) {
      const phrase = r.phrase.replace(/\s+/g, " ").trim().slice(0, 200);
      if (!phrase) { blank++; continue; }
      if (have.has(phrase.toLowerCase())) { dupes++; continue; }
      const tier = Math.min(4, Math.max(1, parseInt(r.tier ?? "", 10) || 3));
      await db.keyword.create({ data: { workspaceId: workspace.id, phrase, tier, intent: r.intent || null, cluster: r.cluster || null, notes: r.notes || null } });
      have.add(phrase.toLowerCase());
      added++;
    }
  } else {
    const [topics, open] = await Promise.all([
      db.topic.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } }),
      db.blogIdea.findMany({ where: { workspaceId: workspace.id, status: { in: ["discovered", "approved"] } }, select: { title: true } }),
    ]);
    const topicBy = new Map(topics.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const have = new Set(open.map((i) => i.title.toLowerCase()));
    for (const r of records) {
      const title = cleanTitle(r.title ?? "", 200);
      if (!title) { blank++; continue; }
      if (have.has(title.toLowerCase())) { dupes++; continue; }
      const topicName = (r.topic ?? "").trim();
      const topicId = topicName ? topicBy.get(topicName.toLowerCase()) ?? null : null;
      if (topicName && !topicId) unknownTopics.add(topicName);
      const priority = r.priority && Number.isFinite(Number(r.priority)) ? Math.max(0, Math.min(100, Math.round(Number(r.priority)))) : null;
      await db.blogIdea.create({
        data: {
          workspaceId: workspace.id, title, angle: (r.angle || "").slice(0, 500) || null, keyword: (r.keyword || "").slice(0, 200) || null,
          topicId, priority, ...(priority != null ? { priorityReason: "Set in an imported sheet." } : {}), source: "manual",
        },
      });
      have.add(title.toLowerCase());
      added++;
    }
  }
  await writeAudit({ workspaceId: workspace.id, actorId: user.id, action: "ideas.imported", entityType: kind === "keywords" ? "keyword" : "blog_idea", meta: { kind, added, dupes, blank, unknownTopics: [...unknownTopics].slice(0, 10) } });
  revalidatePath("/ideas");
  revalidatePath("/blog/keywords");
  const noun = kind === "keywords" ? "keyword" : "idea";
  const parts = [
    `Imported ${added} ${noun}${added === 1 ? "" : "s"}${kind === "articles" ? " as Discovered" : ""}.`,
    dupes ? `${dupes} already here, skipped.` : "",
    blank ? `${blank} empty row${blank === 1 ? "" : "s"} skipped.` : "",
    unknownTopics.size ? `No Topic called ${[...unknownTopics].slice(0, 3).map((t) => `“${t}”`).join(", ")}${unknownTopics.size > 3 ? "…" : ""} — those landed in "No topic yet".` : "",
  ].filter(Boolean);
  back(kind, "flash=" + encodeURIComponent(parts.join(" ")));
}
