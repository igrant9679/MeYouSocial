import { fleschReadingEase } from "@/lib/blog-checks";

/**
 * Readability coaching (E-ART-11): the article split at its H2/H3 headings,
 * each section scored (Flesch reading ease) against the article's target
 * reading level, with the sentences and paragraphs that pull it down —
 * long sentences, passive voice, long paragraphs. Advisory, like the
 * readability check it sits beside: it never gates a publish.
 *
 * Passive voice is a heuristic (a form of "to be" followed by a past
 * participle) — it finds most and misses some, and the panel says so.
 */

export type Level = "simple" | "standard" | "advanced";

export const TARGETS: Record<Level, { flesch: number; sentence: number; paragraph: number; label: string }> = {
  simple: { flesch: 60, sentence: 20, paragraph: 90, label: "simple (plain English)" },
  standard: { flesch: 50, sentence: 25, paragraph: 120, label: "standard" },
  advanced: { flesch: 30, sentence: 30, paragraph: 150, label: "advanced" },
};

export function levelOf(v: string | null | undefined): Level {
  return v === "simple" || v === "advanced" ? v : "standard";
}

export type Flag = { kind: "long_sentence" | "passive" | "long_paragraph"; text: string; words: number; mark?: string };
export type SectionReport = { heading: string; words: number; flesch: number | null; target: number; ok: boolean | null; flags: Flag[] };

const IRREGULAR = "known|shown|given|taken|made|done|seen|written|built|found|held|kept|left|lost|paid|put|said|sent|set|sold|told|thought|understood|won|chosen|driven|eaten|fallen|forgotten|frozen|hidden|ridden|risen|spoken|stolen|sworn|thrown|woken|worn|begun|brought|bought|caught|fought|taught|meant|read|run|cut|hit|shut|spread|led|fed|met|bound|ground|wound|drawn|grown|blown|flown|thrown";
const PASSIVE = new RegExp(`\\b(am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(\\w+ed|${IRREGULAR})\\b`, "i");

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const words = (s: string) => (s.match(/[\p{L}\p{N}']+/gu) ?? []).length;

/** Sentences of a paragraph: split after . ! ? followed by a space and a capital, quote or digit. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=["'“‘(\p{Lu}\p{N}])/u).map((s) => s.trim()).filter(Boolean);
}

/** The body (HTML or markdown) as sections of paragraphs. */
export function sectionsOf(body: string): Array<{ heading: string; paragraphs: string[] }> {
  const html = /<\/?(p|h[1-6]|li|div|br)\b/i.test(body);
  const out: Array<{ heading: string; paragraphs: string[] }> = [{ heading: "Introduction", paragraphs: [] }];
  if (html) {
    // Headings and block elements become their own lines, then tags go.
    const flat = body
      .replace(/<(h[23])[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => `\n@@H@@${t.replace(/<[^>]+>/g, "")}\n`)
      .replace(/<\/(p|li|div|h[1456]|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(script|style|figure|table|pre)[\s\S]*?<\/\1>/gi, "\n")
      .replace(/<[^>]+>/g, "");
    for (const raw of flat.split("\n")) {
      const line = decode(raw).trim();
      if (!line) continue;
      if (line.startsWith("@@H@@")) out.push({ heading: line.slice(5).trim() || "Untitled section", paragraphs: [] });
      else out[out.length - 1].paragraphs.push(line);
    }
  } else {
    let para: string[] = [];
    const flush = () => { if (para.length) out[out.length - 1].paragraphs.push(para.join(" ")); para = []; };
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      const h = line.match(/^#{2,3}\s+(.*)$/);
      if (h) { flush(); out.push({ heading: h[1].replace(/[*_`]/g, "").trim(), paragraphs: [] }); continue; }
      if (!line || /^#\s/.test(line)) { flush(); continue; }
      para.push(line.replace(/^[-*+]\s+|^\d+[.)]\s+|^>\s?/, "").replace(/[*_`]/g, ""));
    }
    flush();
  }
  return out.filter((s, i) => i > 0 || s.paragraphs.length > 0);
}

export function readabilityReport(body: string | null | undefined, level: Level): SectionReport[] {
  if (!body?.trim()) return [];
  const t = TARGETS[level];
  return sectionsOf(body).map((s) => {
    const flags: Flag[] = [];
    for (const p of s.paragraphs) {
      const pw = words(p);
      if (pw > t.paragraph) flags.push({ kind: "long_paragraph", text: p.length > 160 ? `${p.slice(0, 160)}…` : p, words: pw });
      for (const sentence of sentences(p)) {
        const sw = words(sentence);
        if (sw > t.sentence) flags.push({ kind: "long_sentence", text: sentence, words: sw });
        const m = sentence.match(PASSIVE);
        if (m) flags.push({ kind: "passive", text: sentence, words: sw, mark: m[0] });
      }
    }
    const text = s.paragraphs.join(" ");
    const flesch = fleschReadingEase(text);
    return { heading: s.heading, words: words(text), flesch, target: t.flesch, ok: flesch == null ? null : flesch >= t.flesch, flags };
  });
}
