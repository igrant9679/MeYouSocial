/**
 * Markdown pasted into the article editor becomes formatted text (E-ART-18).
 * Text copied out of a chat window, a README or a notes app is Markdown, and
 * pasted as-is it landed as literal "## Heading" and "**bold**" in the article.
 *
 * Deliberately small: headings, lists, quotes, rules, paragraphs, bold,
 * italic, inline code and links — what such text actually contains. Everything
 * is escaped first, so the only HTML out is the HTML made here, and a link is
 * kept only when it is http(s), mailto or on the site. Pure, so it runs in the
 * editor and in a check alike.
 */

const BLOCK_SIGNS = /^(#{1,6}\s+\S|\s*[-*+]\s+\S|\s*\d{1,3}[.)]\s+\S|>\s?\S|(?:-{3,}|\*{3,}|_{3,})\s*$)/;
const INLINE_SIGNS = /\*\*[^*\n]+\*\*|__[^_\n]+__|\[[^\]\n]+\]\((?:https?:|mailto:|\/)[^)\s]+\)|`[^`\n]+`/;

/** Text that reads as Markdown: a Markdown block on some line, or Markdown emphasis or links. */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;
  const lines = text.split(/\r?\n/);
  return lines.some((l) => BLOCK_SIGNS.test(l)) || INLINE_SIGNS.test(text);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline Markdown on one escaped run of text. */
export function inlineMarkdown(raw: string): string {
  const codes: string[] = [];
  // Inline code first, set aside so nothing inside it is touched.
  let s = escapeHtml(raw).replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, url: string) => {
    const href = url.replace(/&amp;/g, "&");
    if (!/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)) return label;
    return `<a href="${escapeHtml(href)}">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

/**
 * Markdown → the article's HTML. "#" and "##" are both h2 — an article's h1 is
 * its title, which the site's theme prints — "###" is h3, deeper is h4.
 */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  const flushPara = () => { if (para.length) out.push(`<p>${inlineMarkdown(para.join(" "))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote><p>${inlineMarkdown(quote.join(" "))}</p></blockquote>`); quote = []; };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushAll(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.+)$/))) {
      flushAll();
      const level = Math.min(Math.max(m[1].length, 2), 4);
      out.push(`<h${level}>${inlineMarkdown(m[2].replace(/\s+#+\s*$/, ""))}</h${level}>`);
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*+]\s+(.+)$/))) {
      flushPara(); flushQuote();
      if (list?.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d{1,3}[.)]\s+(.+)$/))) {
      flushPara(); flushQuote();
      if (list?.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); flushList();
      quote.push(m[1]);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // A continuation line of the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList(); flushQuote();
      para.push(line.trim());
    }
  }
  flushAll();
  // ⚠ No newline between blocks: inserted into the editor, a bare newline
  // between two blocks becomes an empty paragraph of its own.
  return out.join("");
}

/** A 3×3 table with a header row, for the toolbar's Insert table. */
export function blankTableHtml(cols = 3, rows = 2): string {
  const cell = (tag: "th" | "td", i: number) => `<${tag}>${tag === "th" ? `Heading ${i + 1}` : "&nbsp;"}</${tag}>`;
  const head = `<tr>${Array.from({ length: cols }, (_, i) => cell("th", i)).join("")}</tr>`;
  const body = Array.from({ length: rows }, () => `<tr>${Array.from({ length: cols }, (_, i) => cell("td", i)).join("")}</tr>`).join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table><p><br></p>`;
}
