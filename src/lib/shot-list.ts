/**
 * The shot list a script asks for (E-VID-09): every B-roll, shot, cutaway,
 * insert or graphic the writer marked, under the section it belongs to, so
 * the footage can be gathered before the shoot and the Film Queue shows what
 * each project still needs.
 *
 * Read from the writer's own markers — `[B-roll: the front door]`,
 * `[Shot: close on the bread]`, `[Cutaway: …]`, `[Insert: …]`,
 * `[Graphic: …]`, and `(b-roll …)` inline — never invented: a section with no
 * marker asks for nothing. Pure.
 */

import { db } from "@/lib/db";

export type ShotKind = "broll" | "shot" | "graphic";
export type Shot = { section: string; kind: ShotKind; description: string };

const MARKER = /\[(b-?roll|shot|cutaway|insert|graphic|on-?screen)\s*:\s*([^\]]+)\]|\((b-?roll)\s*:?\s*([^)]+)\)/gi;

const kindOf = (tag: string): ShotKind => {
  const t = tag.toLowerCase().replace("-", "");
  if (t === "broll" || t === "cutaway" || t === "insert") return "broll";
  if (t === "graphic" || t === "onscreen") return "graphic";
  return "shot";
};

const clean = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

export function extractShotList(body: string): Shot[] {
  const shots: Shot[] = [];
  const seen = new Set<string>();
  let section = "Opening";
  // Walk the body block by block, so a marker is filed under the heading above it.
  const blocks = body
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|\n)/i)
    .filter((b) => b && b.trim());
  for (const block of blocks) {
    const h = block.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i) ?? block.match(/^\s*#{1,6}\s+(.+)$/);
    if (h) {
      section = clean(h[1].replace(/<[^>]+>/g, "")).slice(0, 80) || section;
      continue;
    }
    const text = clean(block.replace(/<[^>]+>/g, " "));
    for (const m of text.matchAll(MARKER)) {
      const tag = m[1] ?? m[3] ?? "shot";
      const description = clean(m[2] ?? m[4] ?? "").replace(/[.;,]+$/, "").slice(0, 160);
      if (!description) continue;
      const key = `${section.toLowerCase()}|${description.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shots.push({ section, kind: kindOf(tag), description });
    }
  }
  return shots;
}

export const SHOT_SOURCE = "shot_list";

export type ShotSync = { added: number; kept: number; gone: number; project: string | null; shots: number };

/**
 * Put a script's shot list into Assets, linked to its project, so the Film
 * Queue lists what each shoot still needs (E-VID-09). Idempotent: a shot
 * already there (same section and words) is kept as it is — with any file
 * someone attached — and one no longer in the script is NOT deleted (it may
 * have been filmed already), only counted. Never touches another workspace.
 */
export async function syncShotList(workspaceId: string, scriptId: string): Promise<ShotSync | null> {
  const script = await db.script.findFirst({
    where: { id: scriptId, channel: { workspaceId } },
    select: { id: true, body: true, channelId: true, contentProject: { select: { id: true } } },
  });
  if (!script) return null;
  const shots = extractShotList(script.body ?? "");
  const projectId = script.contentProject?.id ?? null;
  const existing = await db.asset.findMany({
    where: { workspaceId, source: SHOT_SOURCE, ...(projectId ? { links: { some: { contentProjectId: projectId } } } : { channelId: script.channelId, tags: { contains: `"script:${script.id}"` } }) },
    select: { id: true, name: true, tags: true },
  });
  const keyOf = (section: string, description: string) => `${section.toLowerCase()}|${description.toLowerCase()}`;
  const have = new Map(existing.map((a) => {
    let tags: string[] = [];
    try { tags = JSON.parse(a.tags); } catch { /* none */ }
    const section = tags.find((t) => t.startsWith("section:"))?.slice(8) ?? "";
    return [keyOf(section, a.name), a.id] as const;
  }));
  let added = 0;
  for (const s of shots) {
    if (have.has(keyOf(s.section, s.description))) continue;
    const asset = await db.asset.create({
      data: {
        workspaceId,
        channelId: script.channelId,
        kind: s.kind,
        name: s.description,
        source: SHOT_SOURCE,
        tags: JSON.stringify(["shot-list", `section:${s.section}`, `script:${script.id}`]),
      },
    });
    if (projectId) await db.assetLink.create({ data: { assetId: asset.id, contentProjectId: projectId } });
    added++;
  }
  const wanted = new Set(shots.map((s) => keyOf(s.section, s.description)));
  const gone = [...have.keys()].filter((k) => !wanted.has(k)).length;
  return { added, kept: shots.length - added, gone, project: projectId, shots: shots.length };
}

/** A shot-list asset's section, read back from its tags. Pure. */
export function shotSection(tagsJson: string): string {
  try {
    const tags = JSON.parse(tagsJson) as unknown;
    return Array.isArray(tags) ? (tags.find((t): t is string => typeof t === "string" && t.startsWith("section:"))?.slice(8) ?? "") : "";
  } catch {
    return "";
  }
}
