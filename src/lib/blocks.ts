/**
 * A small block model for the Company info editor.
 *
 * ⚠ WHY BLOCKS AND PLAIN TEXT BOTH EXIST. `OrgProfile.description` is PROMPT
 * GROUNDING, not published content: it is injected verbatim into idea
 * discovery, drafting, SEO and the assist actions. Rich markup in that string
 * would put editor syntax into every prompt. So the blocks are the authored
 * form (`OrgProfile.descriptionBlocks`, JSON) and `description` stays the plain
 * text — DERIVED FROM THE BLOCKS ON THE SERVER at save time, never trusted from
 * the client, so the two can't drift apart.
 *
 * Deliberately not WordPress's Gutenberg. Its packages accept React 19, but the
 * real editor is ~60 transitive packages and its own stylesheets for one
 * textarea's worth of content, and its output is block-comment HTML — exactly
 * the markup this field must not carry. This is the same shape (typed blocks,
 * one editable region each, per-block controls) in the app's own components.
 */

export const BLOCK_TYPES = ["paragraph", "heading", "list", "quote", "html"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type Block = {
  id: string;
  type: BlockType;
  /** The block's content. For a list this is ONE ITEM PER LINE — the same
   *  shape Gutenberg's list block edits, and it keeps every block a single
   *  editable region instead of a nested structure. */
  text: string;
  /** heading only: 2 or 3. Never 1 — the page owns its own h1. */
  level?: 2 | 3;
  /** list only. */
  ordered?: boolean;
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  quote: "Quote",
  html: "HTML",
};

/** The four prose types. Company info offers only these — an HTML block there
 *  would put tags into a prompt, which is the one thing that field must not do. */
export const TEXT_BLOCK_TYPES: readonly BlockType[] = ["paragraph", "heading", "list", "quote"];

/** Everything, for the article body, where HTML is the stored form anyway. */
export const RICH_BLOCK_TYPES: readonly BlockType[] = ["paragraph", "heading", "list", "quote", "html"];

export function isBlockType(v: unknown): v is BlockType {
  return typeof v === "string" && (BLOCK_TYPES as readonly string[]).includes(v);
}

/** Ids only have to be unique within one document — they key React rows. */
export function newBlockId(): string {
  return "b" + Math.random().toString(36).slice(2, 10);
}

/**
 * Parse the stored JSON. Tolerant by design: a malformed or hand-edited value
 * must degrade to "no blocks" so the editor can fall back to the plain text,
 * never throw in a server component.
 */
export function parseBlocks(json: string | null | undefined): Block[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!isBlockType(o.type)) continue;
    const text = typeof o.text === "string" ? o.text : "";
    const block: Block = { id: typeof o.id === "string" && o.id ? o.id : newBlockId(), type: o.type, text };
    if (o.type === "heading") block.level = o.level === 3 ? 3 : 2;
    if (o.type === "list") block.ordered = o.ordered === true;
    out.push(block);
    if (out.length >= 200) break; // a company description, not a book
  }
  return out;
}

export function serializeBlocks(blocks: Block[]): string {
  return JSON.stringify(
    blocks
      .filter((b) => b.text.trim() !== "")
      .map((b) => ({
        id: b.id,
        type: b.type,
        text: b.text.trim(),
        ...(b.type === "heading" ? { level: b.level === 3 ? 3 : 2 } : {}),
        ...(b.type === "list" ? { ordered: b.ordered === true } : {}),
      })),
  );
}

/**
 * The string a prompt actually sees. Structure survives as ordinary punctuation
 * — a heading is a line, a list is dashed lines — because that is how a person
 * would type it, and the model reads it the same way.
 */
export function blocksToPlainText(blocks: Block[]): string {
  // ⚠ Tags are stripped, always. A block's text may legitimately carry inline
  // HTML (the article body's blocks do), and an `html` block carries markup
  // outright — none of that belongs in a string a model reads as prose.
  const strip = (s: string) =>
    s.replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ 	]{2,}/g, " ")
      .trim();
  const parts: string[] = [];
  for (const b of blocks) {
    const text = strip(b.text);
    if (!text) continue;
    if (b.type === "list") {
      const items = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!items.length) continue;
      parts.push(items.map((l, i) => (b.ordered ? `${i + 1}. ${l}` : `- ${l}`)).join("\n"));
    } else if (b.type === "quote") {
      parts.push(text.split("\n").map((l) => `"${l.trim()}"`).join("\n"));
    } else {
      parts.push(text);
    }
  }
  return parts.join("\n\n").trim();
}

/**
 * Plain text → blocks, for the first open of a description written before the
 * editor existed, and for accepting an AI draft (which is prose).
 *
 * Blank lines separate blocks; a run of "- " or "1. " lines becomes one list;
 * "## " marks a heading. Anything else is a paragraph — the safe default.
 */
export function plainTextToBlocks(text: string): Block[] {
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const out: Block[] = [];
  for (const chunk of clean.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    if (!lines.length) continue;

    const bulleted = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
    if (bulleted || numbered) {
      out.push({
        id: newBlockId(),
        type: "list",
        ordered: numbered,
        text: lines.map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")).join("\n"),
      });
      continue;
    }
    const heading = lines.length === 1 ? lines[0].match(/^(#{2,3})\s+(.*)$/) : null;
    if (heading) {
      out.push({ id: newBlockId(), type: "heading", level: heading[1].length === 3 ? 3 : 2, text: heading[2].trim() });
      continue;
    }
    if (lines.every((l) => /^\s*>\s?/.test(l))) {
      out.push({ id: newBlockId(), type: "quote", text: lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n") });
      continue;
    }
    out.push({ id: newBlockId(), type: "paragraph", text: lines.join(" ") });
  }
  return out;
}

// ── HTML ⇄ blocks, for the article body ──────────────────────────────────────
//
// ⚠ THE ARTICLE BODY'S CANONICAL FORM IS HTML, NOT BLOCKS. `BlogPost.body` is
// what publishCore sends to WordPress, what the HTML export embeds, and what
// the checks read. Blocks are a VIEW over it, converted on the way in and out.
// That is why the `html` block exists: anything these functions can't model as
// prose — an image, a table, a figure, an embed — survives verbatim in one,
// instead of being silently dropped by a round-trip through the editor. A
// lossy pass over a published article is exactly the failure this codebase
// keeps finding, so it does not get to happen here.

const INLINE_OK = /^(a|b|strong|i|em|u|code|span|br|sub|sup|small|mark|del|ins)$/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Blocks → HTML. Inline markup inside a block's text (links, bold) is already
 * HTML and is passed through; the block itself supplies the wrapper.
 */
export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    if (b.type === "html") {
      out.push(text);
    } else if (b.type === "heading") {
      const level = b.level === 3 ? 3 : 2;
      out.push(`<h${level}>${text}</h${level}>`);
    } else if (b.type === "list") {
      const items = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!items.length) continue;
      const tag = b.ordered ? "ol" : "ul";
      out.push(`<${tag}>\n${items.map((l) => `  <li>${l}</li>`).join("\n")}\n</${tag}>`);
    } else if (b.type === "quote") {
      out.push(`<blockquote>${text.split("\n").map((l) => `<p>${l.trim()}</p>`).join("")}</blockquote>`);
    } else {
      out.push(`<p>${text}</p>`);
    }
  }
  return out.join("\n\n");
}

/**
 * HTML → blocks. ⚠ BROWSER ONLY — it uses DOMParser, so call it from a client
 * component. Anything that isn't a recognised prose element becomes an `html`
 * block holding its exact markup, so `blocksToHtml(htmlToBlocks(x))` keeps
 * every image, table and embed that `x` had.
 */
export function htmlToBlocks(html: string): Block[] {
  const source = (html ?? "").trim();
  if (!source) return [];
  if (typeof DOMParser === "undefined") return plainTextToBlocks(source);

  const doc = new DOMParser().parseFromString(source, "text/html");
  const out: Block[] = [];
  const pushHtml = (markup: string) => {
    const m = markup.trim();
    if (m) out.push({ id: newBlockId(), type: "html", text: m });
  };

  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === 3) {
      // A bare text node between elements is still prose the author wrote.
      const t = (node.textContent ?? "").trim();
      if (t) out.push({ id: newBlockId(), type: "paragraph", text: escapeHtml(t) });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const inner = el.innerHTML.trim();

    if (tag === "p") {
      // A paragraph that only wraps an image (or anything block-ish) is not
      // prose — keep it whole rather than losing the child.
      const onlyInline = [...el.children].every((c) => INLINE_OK.test(c.tagName));
      if (onlyInline) out.push({ id: newBlockId(), type: "paragraph", text: inner });
      else pushHtml(el.outerHTML);
    } else if (tag === "h2" || tag === "h3") {
      out.push({ id: newBlockId(), type: "heading", level: tag === "h3" ? 3 : 2, text: inner });
    } else if (tag === "ul" || tag === "ol") {
      const items = [...el.children].filter((c) => c.tagName.toLowerCase() === "li");
      // A nested list can't be represented one-item-per-line — pass it through.
      const nested = items.some((li) => li.querySelector("ul,ol"));
      if (!items.length || nested) pushHtml(el.outerHTML);
      else out.push({
        id: newBlockId(),
        type: "list",
        ordered: tag === "ol",
        text: items.map((li) => li.innerHTML.trim().replace(/\s*\n\s*/g, " ")).join("\n"),
      });
    } else if (tag === "blockquote") {
      const ps = [...el.children].filter((c) => c.tagName.toLowerCase() === "p");
      const complex = [...el.children].some((c) => c.tagName.toLowerCase() !== "p");
      if (complex) pushHtml(el.outerHTML);
      else out.push({
        id: newBlockId(),
        type: "quote",
        text: (ps.length ? ps.map((c) => c.innerHTML.trim()) : [inner]).join("\n"),
      });
    } else {
      // h1, figure, img, table, div, section, embeds — verbatim.
      pushHtml(el.outerHTML);
    }
  }
  return out;
}
