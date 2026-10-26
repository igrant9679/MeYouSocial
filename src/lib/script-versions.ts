import { db } from "@/lib/db";

/**
 * Keep what a script says NOW before something overwrites it.
 *
 * ⚠ Regenerate, Stream, Re-run Agent and the Builder all used to snapshot only
 * the text they had just produced, so a hand-edited draft was gone the moment
 * one of them ran (audit VID-02). Called right before every overwrite; a
 * script with nothing in it, or one identical to its latest snapshot, isn't
 * saved again.
 */
export async function snapshotScript(
  script: { id: string; body: string | null; outline: string | null; wordCount: number },
  label: string,
): Promise<void> {
  if (!script.body?.trim() && !script.outline?.trim()) return;
  const last = await db.scriptVersion.findFirst({
    where: { scriptId: script.id },
    orderBy: { createdAt: "desc" },
    select: { body: true, outline: true },
  });
  if (last && last.body === script.body && last.outline === script.outline) return;
  await db.scriptVersion.create({
    data: { scriptId: script.id, label: label.slice(0, 80), body: script.body, outline: script.outline, wordCount: script.wordCount },
  });
}

/**
 * A snapshot's outline as the script column stores it. Older snapshots hold
 * the bare markdown; the column holds `{ questions, markdown }` JSON. The
 * script's own planning answers are kept when only markdown was saved.
 */
export function outlineForRestore(saved: string | null, current: string | null): string | null {
  if (saved == null) return current;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object" && "markdown" in parsed) return saved;
  } catch {
    // bare markdown
  }
  let base: Record<string, unknown> = {};
  try {
    base = current ? (JSON.parse(current) as Record<string, unknown>) : {};
  } catch {
    base = {};
  }
  return JSON.stringify({ ...base, markdown: saved });
}
