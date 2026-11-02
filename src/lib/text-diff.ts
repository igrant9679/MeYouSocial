/**
 * Compare two versions of an article (E-ART-03): its HTML as blocks —
 * headings, paragraphs, list items, quotes — matched by a longest common
 * subsequence, then the words of each changed pair compared the same way.
 * No library: the inputs are one article each, and the caps below keep the
 * tables small (past them a block or a pair is shown as replaced whole).
 */

export type Block = { tag: string; text: string };
export type Seg = { kind: "same" | "add" | "del"; text: string };
export type Row =
  | { kind: "same" | "add" | "del"; tag: string; text: string }
  | { kind: "change"; tagA: string; tagB: string; left: Seg[]; right: Seg[] };

const BLOCK = /^(h[1-6]|p|li|blockquote|pre|figcaption|td|th|dt|dd|caption)$/;
const BREAK = /^(ul|ol|table|thead|tbody|tr|figure|div|section|article|aside|header|footer|br|hr)$/;
const NAMED: Record<string, string> = { mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•", times: "×", eacute: "é", euro: "€", pound: "£" };
const decode = (s: string) =>
  s.replace(/&([a-z]+);/g, (m, n: string) => NAMED[n] ?? m).replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** An article's HTML as its readable blocks, in order. Images become "[image: alt]". */
export function htmlBlocks(html: string | null | undefined): Block[] {
  const out: Block[] = [];
  let tag = "p";
  let buf = "";
  const flush = () => {
    const text = decode(buf).replace(/\s+/g, " ").trim();
    if (text) out.push({ tag, text });
    buf = "";
  };
  for (const m of (html ?? "").matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g)) {
    const name = m[1]?.toLowerCase();
    if (!name) {
      if (!m[0].startsWith("<!--")) buf += m[0];
      continue;
    }
    if (BLOCK.test(name)) {
      flush();
      tag = m[0][1] === "/" ? "p" : name;
    } else if (BREAK.test(name)) {
      flush();
      tag = "p";
    } else if (name === "img") {
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]?.trim();
      buf += ` [image${alt ? `: ${alt}` : ""}] `;
    }
  }
  flush();
  return out;
}

/** LCS pairs (i, j) of equal items, in order; null when the table would be too big. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean, maxCells: number): Array<[number, number]> | null {
  const n = a.length, m = b.length;
  if (n * m > maxCells) return null;
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = eq(a[i], b[j]) ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Word-level difference of two texts, as the left (old) and right (new) sides. */
export function diffWords(a: string, b: string): { left: Seg[]; right: Seg[] } {
  const wa = a.split(/\s+/).filter(Boolean), wb = b.split(/\s+/).filter(Boolean);
  const pairs = lcs(wa, wb, (x, y) => x === y, 400_000);
  if (!pairs) return { left: [{ kind: "del", text: a }], right: [{ kind: "add", text: b }] };
  const left: Seg[] = [], right: Seg[] = [];
  const push = (side: Seg[], kind: Seg["kind"], word: string) => {
    const last = side[side.length - 1];
    if (last?.kind === kind) last.text += ` ${word}`;
    else side.push({ kind, text: word });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [wa.length, wb.length] as [number, number]]) {
    while (i < pi) push(left, "del", wa[i++]);
    while (j < pj) push(right, "add", wb[j++]);
    if (pi < wa.length) { push(left, "same", wa[pi]); push(right, "same", wb[pj]); i++; j++; }
  }
  return { left, right };
}

/** Share of words two texts have in common, 0..1 — whether a removed and an added block are "the same paragraph, edited". */
function likeness(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/)), sb = new Set(b.toLowerCase().split(/\s+/));
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return common / Math.max(1, Math.min(sa.size, sb.size));
}

export function diffBlocks(a: Block[], b: Block[]): Row[] {
  const pairs = lcs(a, b, (x, y) => x.tag === y.tag && x.text === y.text, 4_000_000) ?? [];
  const rows: Row[] = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    const dels = a.slice(i, pi), adds = b.slice(j, pj);
    // Within one run of removals and additions, pair blocks in order while
    // they look like edits of each other; the rest are plain removals/additions.
    let x = 0, y = 0;
    while (x < dels.length || y < adds.length) {
      if (x < dels.length && y < adds.length && likeness(dels[x].text, adds[y].text) >= 0.4) {
        rows.push({ kind: "change", tagA: dels[x].tag, tagB: adds[y].tag, ...diffWords(dels[x].text, adds[y].text) });
        x++; y++;
      } else if (x < dels.length && (y >= adds.length || dels.length - x >= adds.length - y)) {
        rows.push({ kind: "del", tag: dels[x].tag, text: dels[x].text }); x++;
      } else {
        rows.push({ kind: "add", tag: adds[y].tag, text: adds[y].text }); y++;
      }
    }
    if (pi < a.length) rows.push({ kind: "same", tag: a[pi].tag, text: a[pi].text });
    i = pi + 1; j = pj + 1;
  }
  return rows;
}

/** Words added and removed, and blocks touched. */
export function diffStats(rows: Row[]): { added: number; removed: number; blocks: number } {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  let added = 0, removed = 0, blocks = 0;
  for (const r of rows) {
    if (r.kind === "same") continue;
    blocks++;
    if (r.kind === "change") {
      for (const s of r.right) if (s.kind === "add") added += words(s.text);
      for (const s of r.left) if (s.kind === "del") removed += words(s.text);
    } else if (r.kind === "add") added += words(r.text);
    else removed += words(r.text);
  }
  return { added, removed, blocks };
}
