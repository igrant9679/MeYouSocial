/**
 * Which feed items a workspace wants (E-SOC-20). Words are phrases separated
 * by commas or new lines, matched case-insensitively as whole words against
 * the item's title and summary. An exclude match always wins; with include
 * words set, an item needs at least one of them. The reason is kept on the
 * item so the page can say why something was skipped.
 */

export function parseWords(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,\n]/).map((w) => w.trim().toLowerCase().replace(/\s+/g, " ")).filter((w) => w.length > 1))].slice(0, 40);
}

/** The words as stored: one comma-separated line, or null when there are none. */
export function storeWords(raw: string | null | undefined): string | null {
  const words = parseWords(raw);
  return words.length ? words.join(", ").slice(0, 1000) : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, phrase: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(phrase)}($|[^\\p{L}\\p{N}])`, "iu").test(text);

export function itemSkipReason(item: { title: string; summary: string | null }, include: string[], exclude: string[]): string | null {
  const text = `${item.title} ${item.summary ?? ""}`;
  const hit = exclude.find((w) => has(text, w));
  if (hit) return `mentions “${hit}”`;
  if (include.length && !include.some((w) => has(text, w))) return "none of the include words";
  return null;
}
