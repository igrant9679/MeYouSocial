import { cleanTitle } from "@/lib/list-marker";

/**
 * The video ideas a deep-research report already proposes (E-IDE-15): the list
 * under its "Suggested angles" heading, which the report prompt asks for. Read
 * from the report, not asked of a model again, so "Make ideas from this report"
 * costs nothing and makes exactly what the report says — and makes nothing
 * when the report has no such list.
 */
export type ReportAngle = { title: string; angle: string };

const SECTION = /suggested angles/i;
// The next section starts at a markdown heading, or at a bold label naming one
// of the report's other sections ("6. **Sources**") — a bare bold line can also
// be an angle's title, so the label has to be one the prompt asks for.
const OTHER_SECTION = /^\s*(\d+[.)]\s+)?\*\*\s*(sources|references|tl;?dr|key facts|contested claims|surprising data( points)?)\b/i;
const isNextSection = (line: string) => /^\s*#{1,6}\s/.test(line) || OTHER_SECTION.test(line);
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/;
const strip = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/\[(\d+)\]/g, "").replace(/\s+/g, " ").trim();

export function anglesFromReport(markdown: string | null | undefined, max = 8): ReportAngle[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => SECTION.test(l) && (/^\s*#/.test(l) || /\*\*[^*]*suggested angles[^*]*\*\*/i.test(l)));
  if (start < 0) return [];
  const out: ReportAngle[] = [];
  let baseIndent: number | null = null;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (isNextSection(line)) break;
    const m = line.match(ITEM);
    if (!m) {
      // A continuation line belongs to the angle above it.
      if (out.length) out[out.length - 1].angle = strip(`${out[out.length - 1].angle} ${line}`).slice(0, 500);
      continue;
    }
    const indent = m[1].length;
    if (baseIndent === null) baseIndent = indent;
    if (indent > baseIndent && out.length) {
      out[out.length - 1].angle = strip(`${out[out.length - 1].angle} ${m[3]}`).slice(0, 500);
      continue;
    }
    const text = m[3].trim();
    // "**Title** — why", "“Title”: why", "Title — why", or just "Title".
    const split = text.match(/^\*\*(.+?)\*\*\s*[:\-–—]?\s*(.*)$/) ?? text.match(/^[“"](.+?)[”"]\s*[:\-–—]?\s*(.*)$/) ?? text.match(/^(.+?)\s+[–—-]\s+(.+)$/) ?? text.match(/^([^:]{4,140}):\s+(.+)$/);
    const title = cleanTitle(strip(split ? split[1] : text), 200);
    if (!title) continue;
    out.push({ title, angle: split ? strip(split[2]).slice(0, 500) : "" });
    if (out.length >= max) break;
  }
  return out;
}
